import { useCallback, useEffect, useState } from 'react';
import { ApiError, handleApiResponse } from '../../lib/api-error';
import { fetchRead, unlockRead, type ReadClaim, type ReadNext } from '../../services/readApi';
import { fetchGapPrompt, fetchV2Gaps, fetchV2Shipped, type V2Gap } from '../../services/v2Api';
import { clampScore, fetchProductMap, type ProductMapData } from '../../services/productMapApi';
import type { BuildGap, BuildNext, BuildSection, LaunchCheck, ProjectStory, ShippedChange, StoryPersona } from './types';

// Loads the real data behind the project page and maps it into ProjectStory.
// The view knows nothing about the API; this file is the only place that does.

interface LaunchResponse {
  name: string;
  updatedAt: string | null;
  checks: LaunchCheck[];
  notChecked: string[];
}

async function fetchLaunch(projectId: string): Promise<LaunchResponse> {
  const res = await fetch(`/api/v2/projects/${projectId}/launch`, { credentials: 'include' });
  return handleApiResponse<LaunchResponse>(res);
}

export function formatAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'recently';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 'recently';
  const mins = Math.max(0, Math.round((now - t) / 60_000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

const SLOT_ORDER = ['objective', 'audience', 'core_job'];

export function told(claims: ReadClaim[]): string[] {
  return [...claims]
    .sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
    .map((c) => c.text.trim())
    .filter(Boolean);
}

function list(labels: string[], lower = true): string {
  const l = lower ? labels.map((x) => x.toLowerCase()) : labels;
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
}

export function verdict(checks: LaunchCheck[], notChecked: string[]): { headline: string; support: string } {
  const grounded = checks.filter((c) => c.status === 'grounded');
  const holding = checks.filter((c) => c.status === 'holding');
  const gap = notChecked.length
    ? ` We don’t check ${list(notChecked)} yet, so this isn’t the whole picture.`
    : '';
  if (grounded.length > 0) {
    return {
      headline: 'Not ready to go live yet.',
      support: `${list(grounded.map((c) => c.label), false)} ${grounded.length === 1 ? 'is' : 'are'} missing.${gap}`,
    };
  }
  if (holding.length > 0) {
    return {
      headline: 'Nearly ready to go live.',
      support: `${list(holding.map((c) => c.label), false)} ${holding.length === 1 ? 'is' : 'are'} only partly there.${gap}`,
    };
  }
  return { headline: 'The basics are in place.', support: `Everything we check matches what a launch needs.${gap}` };
}

export function promptFor(check: LaunchCheck): string {
  return [
    `My app needs this before it goes live: ${check.need}`,
    `Right now: ${check.explanation}`,
    'Look at how the app does this today, make the smallest change that fixes it, and tell me in plain words what you changed.',
  ].join('\n\n');
}

export type ToldState = { status: 'ready' | 'drafting' | 'failed'; lines: string[] };

export function toNext(next: ReadNext | undefined): BuildNext | null {
  if (!next || !(next.title || next.why)) return null;
  return { title: next.title ?? 'The next thing to build', why: next.why ?? '', prompt: next.prompt, gated: next.gated };
}

/** 404 or no claims means the read is still being drafted; anything else is a failure. */
export async function loadRead(projectId: string): Promise<{ told: ToldState; next: BuildNext | null }> {
  try {
    const read = await fetchRead(projectId);
    const lines = told(read.claims);
    return {
      told: lines.length > 0 ? { status: 'ready', lines } : { status: 'drafting', lines: [] },
      next: toNext(read.next),
    };
  } catch (err) {
    const status = err instanceof ApiError && err.status === 404 ? 'drafting' : 'failed';
    return { told: { status, lines: [] }, next: null };
  }
}

// The checks already cover infrastructure, so only features that are missing
// or broken are listed, and only ones nobody has dismissed or shipped.
export function toBuildGaps(gaps: { broken: V2Gap[]; missing: V2Gap[] }): BuildGap[] {
  const open = (g: V2Gap) => g.status === 'untriaged' || g.status === 'in-progress';
  const map = (kind: 'broken' | 'missing') => (g: V2Gap): BuildGap => ({
    id: g.id,
    title: g.title,
    summary: g.description,
    kind,
    jobs: (g.affectedJobs ?? []).map((j) => ({ persona: j.personaName, job: j.jobTitle })),
    prompt: g.prompt ?? null,
  });
  return [...gaps.broken.filter(open).map(map('broken')), ...gaps.missing.filter(open).map(map('missing'))]
    // Gaps that name who they matter to come first: that is the context.
    .sort((a, b) => Number(b.jobs.length > 0) - Number(a.jobs.length > 0));
}

// A job counts as done at the same score the product map shows as ready.
const JOB_DONE_SCORE = 80;
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function toPersonas(map: ProductMapData | null): StoryPersona[] {
  if (!map) return [];
  const scores = map.scores?.job ?? {};
  return map.personas
    .map((p) => {
      const jobs = map.jobs
        .filter((j) => j.personaId === p.id)
        .map((j) => ({
          id: j.id,
          title: j.title,
          done: (clampScore(scores[j.id]) ?? 0) >= JOB_DONE_SCORE,
          rank: PRIORITY_RANK[j.priority] ?? 1,
        }))
        .sort((a, b) => Number(a.done) - Number(b.done) || a.rank - b.rank)
        .map(({ id, title, done }) => ({ id, title, done }));
      return { id: p.id, name: p.name, description: p.description, jobs };
    })
    .filter((p) => p.name && p.jobs.length > 0);
}

export async function loadPersonas(projectId: string): Promise<StoryPersona[]> {
  try {
    return toPersonas(await fetchProductMap(projectId));
  } catch {
    return [];
  }
}

export async function loadGaps(projectId: string): Promise<BuildGap[]> {
  try {
    return toBuildGaps(await fetchV2Gaps(projectId));
  } catch {
    return [];
  }
}

/** The prompt for a gap: the saved one, or one generated on request. */
export async function gapPrompt(projectId: string, gap: BuildGap): Promise<string> {
  return gap.prompt || (await fetchGapPrompt(projectId, gap.id));
}

export function buildStory(
  launch: LaunchResponse,
  toldState: ToldState,
  build: BuildSection,
  shipped: ShippedChange[],
  personas: StoryPersona[] = [],
): ProjectStory | null {
  if (launch.checks.length === 0) return null;
  const { headline, support } = verdict(launch.checks, launch.notChecked);
  return {
    name: launch.name,
    headline,
    support,
    told: toldState.lines,
    toldStatus: toldState.status,
    checks: launch.checks,
    personas: personas.length > 0 ? personas : undefined,
    build: build.next || build.gaps.length > 0 ? build : undefined,
    shipped,
    readAt: formatAgo(launch.updatedAt),
  };
}

function withRead(story: ProjectStory, read: { told: ToldState; next: BuildNext | null }): ProjectStory {
  const gaps = story.build?.gaps ?? [];
  const build = read.next || gaps.length > 0 ? { next: read.next, gaps } : undefined;
  return { ...story, told: read.told.lines, toldStatus: read.told.status, build };
}

export interface LoadedStory {
  story: ProjectStory | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useProjectStory(projectId: string | undefined, signedIn = false): LoadedStory {
  const [state, setState] = useState<Omit<LoadedStory, 'reload'>>({ story: null, loading: true, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!projectId) {
      setState({ story: null, loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ story: null, loading: true, error: null });
    (async () => {
      try {
        const launch = await fetchLaunch(projectId);
        // The read and the recent merges are extras: the page still works without them.
        const [read, gaps, personas, merged] = await Promise.all([
          loadRead(projectId),
          loadGaps(projectId),
          loadPersonas(projectId),
          fetchV2Shipped(projectId).catch(() => null),
        ]);
        const shipped: ShippedChange[] = (merged?.recentMerges ?? []).map((m) => ({
          id: String(m.number),
          summary: (m.summary || m.title).trim(),
          when: formatAgo(m.mergedAt),
        }));
        if (!cancelled) {
          setState({ story: buildStory(launch, read.told, { next: read.next, gaps }, shipped, personas), loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState({ story: null, loading: false, error: err instanceof Error ? err.message : 'Something went wrong.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, tick]);

  // The old page polls while the read is drafted; do the same, for the summary only.
  const drafting = state.story?.toldStatus === 'drafting';
  useEffect(() => {
    if (!projectId || !drafting) return undefined;
    let tries = 0;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      tries += 1;
      const next = await loadRead(projectId);
      if (cancelled) return;
      if (next.told.status !== 'drafting') {
        setState((s) => (s.story ? { ...s, story: withRead(s.story, next) } : s));
        window.clearInterval(timer);
      } else if (tries >= 36) {
        window.clearInterval(timer);
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [projectId, drafting]);

  // The next feature's prompt is only sent once someone is signed in; ask for it then.
  const gated = state.story?.build?.next?.gated === true;
  useEffect(() => {
    if (!projectId || !signedIn || !gated) return undefined;
    let cancelled = false;
    unlockRead(projectId)
      .then((payload) => {
        const next = toNext(payload.next);
        if (cancelled || !next) return;
        setState((s) => (s.story?.build ? { ...s, story: { ...s.story, build: { ...s.story.build, next } } } : s));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId, signedIn, gated]);

  return { ...state, reload };
}

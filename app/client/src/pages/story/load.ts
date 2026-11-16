import { useCallback, useEffect, useState } from 'react';
import { ApiError, handleApiResponse } from '../../lib/api-error';
import { fetchRead, type ReadClaim } from '../../services/readApi';
import { fetchV2Shipped } from '../../services/v2Api';
import type { LaunchCheck, ProjectStory, ShippedChange } from './types';

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

/** 404 or no claims means the read is still being drafted; anything else is a failure. */
export async function loadTold(projectId: string): Promise<ToldState> {
  try {
    const lines = told((await fetchRead(projectId)).claims);
    return lines.length > 0 ? { status: 'ready', lines } : { status: 'drafting', lines: [] };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { status: 'drafting', lines: [] };
    return { status: 'failed', lines: [] };
  }
}

export function buildStory(
  launch: LaunchResponse,
  toldState: ToldState,
  shipped: ShippedChange[],
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
    shipped,
    readAt: formatAgo(launch.updatedAt),
  };
}

export interface LoadedStory {
  story: ProjectStory | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useProjectStory(projectId: string | undefined): LoadedStory {
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
        const [toldState, merged] = await Promise.all([
          loadTold(projectId),
          fetchV2Shipped(projectId).catch(() => null),
        ]);
        const shipped: ShippedChange[] = (merged?.recentMerges ?? []).map((m) => ({
          id: String(m.number),
          summary: (m.summary || m.title).trim(),
          when: formatAgo(m.mergedAt),
        }));
        if (!cancelled) {
          setState({ story: buildStory(launch, toldState, shipped), loading: false, error: null });
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
      const next = await loadTold(projectId);
      if (cancelled) return;
      if (next.status !== 'drafting') {
        setState((s) => (s.story ? { ...s, story: { ...s.story, told: next.lines, toldStatus: next.status } } : s));
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

  return { ...state, reload };
}

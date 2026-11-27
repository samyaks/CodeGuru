import { useEffect, useState } from 'react';
import { fetchAskThreads, type AskThreadSummary, type AskView } from '../../services/askApi';

// How the Ask screens hand text to each other. Both ways go through state
// that only this app can set (router state, sessionStorage), never the URL,
// so a link from outside can't put words in a box. Nothing handed over is
// ever submitted for the person: they read it and press the button.

export const MAX_QUESTION = 4000;

/** Router state for /read/:id/ask/new. `prefill` fills the box; `ask` is a question the person already pressed Ask on. */
export interface AskRouteState {
  prefill?: string;
  ask?: { question: string; nonce: string };
}

export const askPath = (projectId: string, threadId = 'new') =>
  `/read/${encodeURIComponent(projectId)}/ask/${encodeURIComponent(threadId)}`;

/** Text for the box from router state, or ''. */
export function prefillFrom(state: unknown): string {
  const v = state && typeof state === 'object' ? (state as AskRouteState).prefill : undefined;
  return typeof v === 'string' ? v.slice(0, MAX_QUESTION) : '';
}

const PROPOSE_KEY = (projectId: string) => `takeoff:propose-agreement:${projectId}`;
const PROPOSE_TTL_MS = 10 * 60 * 1000;

/** Leave an agreement for the project page's proposal form to fill in. */
export function leaveProposal(projectId: string, text: string) {
  try {
    sessionStorage.setItem(PROPOSE_KEY(projectId), JSON.stringify({ text: text.slice(0, 1000), at: Date.now() }));
  } catch { /* storage off: the person types it */ }
}

/** The agreement left for this project, once; '' when there is none or it is stale. */
export function takeProposal(projectId: string): string {
  try {
    const raw = sessionStorage.getItem(PROPOSE_KEY(projectId));
    if (!raw) return '';
    sessionStorage.removeItem(PROPOSE_KEY(projectId));
    const v = JSON.parse(raw) as { text?: unknown; at?: unknown };
    if (typeof v.text !== 'string' || typeof v.at !== 'number' || Date.now() - v.at > PROPOSE_TTL_MS) return '';
    return v.text.slice(0, 1000);
  } catch {
    return '';
  }
}

export interface AskAccess {
  /** null while checking. */
  available: boolean | null;
  threads: AskThreadSummary[];
  view: AskView;
  reload: () => void;
}

// One check per project while the page is open, shared by every "Ask about this" link.
const checks = new Map<string, Promise<{ threads: AskThreadSummary[]; view: AskView } | null>>();

function check(projectId: string, fresh = false) {
  if (fresh || !checks.has(projectId)) {
    checks.set(projectId, fetchAskThreads(projectId).catch(() => {
      checks.delete(projectId);
      return null;
    }));
  }
  return checks.get(projectId)!;
}

/** After a question or a delete, so the project page lists threads afresh. */
export function forgetAskCheck(projectId: string) {
  checks.delete(projectId);
}

/** Whether this person can ask about this project, and their threads there. */
export function useAskAccess(projectId: string): AskAccess {
  const [state, setState] = useState<{ id: string; data: { threads: AskThreadSummary[]; view: AskView } | null; done: boolean }>({ id: projectId, data: null, done: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    void check(projectId, tick > 0).then((data) => { if (live) setState({ id: projectId, data, done: true }); });
    return () => { live = false; };
  }, [projectId, tick]);
  const current = state.id === projectId ? state : { data: null, done: false };
  return {
    available: current.done ? !!current.data : null,
    threads: current.data?.threads || [],
    view: current.data?.view || 'creator',
    reload: () => setTick((t) => t + 1),
  };
}

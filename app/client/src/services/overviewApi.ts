import { handleApiResponse } from '../lib/api-error';
import type { Decision, Person } from './driftApi';

// Project overview and decision log (Takeoff Milestone 7).
// /api/projects/:id/overview needs a signed-in member.

export type View = 'creator' | 'builder';
export type Verdict = 'matches' | 'drifts' | 'needs_decision';

export interface OverviewArea {
  id: string;
  name: string;
  creators: Array<{ email: string; name: string | null; member: boolean }>;
}

export interface OverviewPr {
  prNumber: number;
  title: string | null;
  url: string;
  author: string | null;
  headSha: string;
  verdict: Verdict;
  summary: string;
  checkedAt: string | null;
  newerPush: boolean;
  needsDecision: boolean;
  lastDecision: Decision | null;
  yours: boolean;
}

export interface PendingAgreement {
  id: string;
  text: string;
  areaId: string | null;
  areaName: string | null;
  proposedBy: Person;
  proposedAt: string | null;
  agreed: number;
  notYet: number;
  members: number;
  yourVote: 'agree' | 'not_yet' | null;
}

export type LogEntry =
  | {
    kind: 'agreement';
    id: string;
    at: string;
    outcome: 'accepted' | 'declined' | 'withdrawn';
    via: 'everyone_agreed' | 'stall_fallback' | 'withdrawn' | null;
    text: string;
    areaName: string | null;
    proposedBy: Person;
    decidedBy: Person | null;
    note: string | null;
    commitUrl: string | null;
    commitPrUrl: string | null;
    sourceUrl: string | null;
  }
  | {
    kind: 'decision';
    id: string;
    at: string;
    outcome: 'accepted' | 'sent_back';
    prNumber: number;
    prUrl: string;
    by: Person;
    confirmedBy: Person | null;
    note: string | null;
    changes: string[];
    agreementText: string | null;
    commitUrl: string | null;
    commentUrl: string | null;
  };

export interface Overview {
  view: { default: View; labels: View[] };
  linked: boolean;
  intent: { ok: boolean; reason: string | null; branch: string | null };
  areas: OverviewArea[];
  pullRequests: OverviewPr[];
  githubLinked: boolean;
  pendingAgreements: PendingAgreement[];
  recentDecisions: LogEntry[];
}

export interface DecisionLog {
  entries: LogEntry[];
  truncated: boolean;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/overview`;

export async function fetchOverview(projectId: string): Promise<Overview> {
  return handleApiResponse<Overview>(await fetch(base(projectId), { credentials: 'include' }));
}

export async function fetchDecisionLog(projectId: string): Promise<DecisionLog> {
  return handleApiResponse<DecisionLog>(await fetch(`${base(projectId)}/decisions`, { credentials: 'include' }));
}

/** The decision log as a Markdown file, saved through the browser. */
export async function downloadDecisionLog(projectId: string): Promise<void> {
  const res = await fetch(`${base(projectId)}/decisions.md`, { credentials: 'include' });
  if (!res.ok) await handleApiResponse(res);
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'takeoff-decisions.md';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

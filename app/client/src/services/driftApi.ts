import { handleApiResponse } from '../lib/api-error';

// Drift review (Takeoff Milestone 5). /api/projects/:id/drift needs a
// signed-in member.

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export type DriftVerdict = 'drifts' | 'needs_decision';
export type DecisionType = 'accepted' | 'sent_back';
export type DecisionState = 'working' | 'done' | 'waiting_for_write' | 'failed' | 'dismissed';
export type TargetKind = 'rule' | 'never' | 'agreement';

export interface Person { userId: string; name: string | null }

export interface Decision {
  id: string;
  prNumber: number;
  headSha: string;
  type: DecisionType;
  state: DecisionState;
  note: string | null;
  changes: string[];
  agreementText: string | null;
  agreementId: string | null;
  by: Person;
  confirmedBy: Person | null;
  commitUrl: string | null;
  commentUrl: string | null;
  recommendationId: string | null;
  error: string | null;
  createdAt: string;
  doneAt: string | null;
}

export interface DriftListItem {
  prNumber: number;
  title: string | null;
  url: string | null;
  headSha: string;
  verdict: DriftVerdict;
  summary: string;
  conflictCount: number;
  checkedAt: string;
  newerPush: boolean;
  lastDecision: Decision | null;
}

export interface DriftList {
  reviews: DriftListItem[];
  decisions: Decision[];
}

export interface Target { kind: TargetKind; area: string | null; text: string }

export interface Conflict {
  area: string | null;
  areaName: string | null;
  ruleOrAgreement: string;
  explanation: string;
  files: string[];
  target: Target | null;
}

export type WhyNot = 'github_unavailable' | 'fork' | 'closed' | 'checking' | 'check_failed' | 'no_drift' | 'decision_running' | 'newer_push';

export interface DriftReview {
  pr: {
    number: number;
    title: string;
    url: string;
    filesUrl: string;
    author: string | null;
    branch: string | null;
    headSha: string | null;
    state: string;
    fork: boolean;
  } | null;
  check: {
    headSha: string;
    status: string;
    verdict: string | null;
    summary: string;
    notes: string[];
    suggestedAgreement: string | null;
    checkedAt: string;
    newerPush: boolean;
    conflicts: Conflict[];
  };
  intent: {
    areas: Array<{ id: string; name: string; creators: string[]; rules: string[]; never: string[] }>;
    allAreas: Array<{ id: string; name: string }>;
    yamlChanged: boolean;
    headValid: boolean;
  };
  decisions: Decision[];
  you: { canDecide: boolean; whyNot: WhyNot | null; canWrite: boolean; writeReason: string | null };
}

export type IntentEdit =
  | { op: 'remove'; target: Target }
  | { op: 'reword'; target: Target; to: string }
  | { op: 'add'; kind: 'rule' | 'never'; area: string; text: string };

export interface DecisionResult {
  decision: Decision;
  status: 'done' | 'failed' | 'recommended';
  reason?: string | null;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/drift`;

export async function fetchDriftList(projectId: string): Promise<DriftList> {
  return handleApiResponse<DriftList>(await authFetch(base(projectId)));
}

export async function fetchDriftReview(projectId: string, prNumber: number): Promise<DriftReview> {
  return handleApiResponse<DriftReview>(await authFetch(`${base(projectId)}/${prNumber}`));
}

export async function acceptDrift(projectId: string, prNumber: number, body: { headSha: string; edits: IntentEdit[]; agreement?: string }): Promise<DecisionResult> {
  return handleApiResponse(await authFetch(`${base(projectId)}/${prNumber}/accept`, jsonInit('POST', body)));
}

export async function sendBackDrift(projectId: string, prNumber: number, body: { headSha: string; note: string }): Promise<DecisionResult> {
  return handleApiResponse(await authFetch(`${base(projectId)}/${prNumber}/send-back`, jsonInit('POST', body)));
}

export async function retryDriftDecision(projectId: string, decisionId: string): Promise<{ decision: Decision }> {
  return handleApiResponse(await authFetch(`${base(projectId)}/decisions/${encodeURIComponent(decisionId)}/retry`, jsonInit('POST')));
}

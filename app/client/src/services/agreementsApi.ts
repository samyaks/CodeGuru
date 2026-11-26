import { handleApiResponse } from '../lib/api-error';

// Team agreements (Takeoff Milestone 3). /api/projects/:id/agreements needs a
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

export type AgreementStatus = 'proposed' | 'accepted' | 'declined' | 'withdrawn';
export type CommitState = 'none' | 'waiting_for_write' | 'committing' | 'committed' | 'pr_opened' | 'failed';
export type VoteChoice = 'agree' | 'not_yet';

export interface Person { userId: string; name: string | null }

export interface Agreement {
  id: string;
  text: string;
  areaId: string | null;
  areaName: string | null;
  source: string | null;
  status: AgreementStatus;
  proposedBy: Person;
  proposedAt: string;
  decidedBy: Person | null;
  decidedAt: string | null;
  decidedVia: 'everyone_agreed' | 'stall_fallback' | 'withdrawn' | null;
  decisionNote: string | null;
  votes: Array<Person & { vote: VoteChoice; comment: string | null; votedAt: string }>;
  waitingOn: Person[];
  stalled: boolean;
  stallAt: string | null;
  you: {
    vote: VoteChoice | null;
    comment: string | null;
    canVote: boolean;
    canWithdraw: boolean;
    canDecide: boolean;
    decideReason: string | null;
    canRetryCommit: boolean;
  };
  commit: {
    state: CommitState;
    sha: string | null;
    url: string | null;
    prUrl: string | null;
    error: string | null;
    recommendationId: string | null;
  };
}

export interface AgreementList {
  agreements: Agreement[];
  areas: Array<{ id: string; name: string }>;
  intent: { ok: boolean; reason: string | null; branch: string | null };
  emailsOn: boolean;
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/agreements`;
const one = (projectId: string, id: string) => `${base(projectId)}/${encodeURIComponent(id)}`;

export async function fetchAgreements(projectId: string): Promise<AgreementList> {
  return handleApiResponse<AgreementList>(await authFetch(base(projectId)));
}

export async function proposeAgreement(projectId: string, body: { text: string; areaId?: string; source?: string }): Promise<{ agreement: Agreement }> {
  return handleApiResponse(await authFetch(base(projectId), jsonInit('POST', body)));
}

export async function voteOnAgreement(projectId: string, id: string, vote: VoteChoice, comment?: string): Promise<{ agreement: Agreement }> {
  return handleApiResponse(await authFetch(`${one(projectId, id)}/vote`, jsonInit('POST', { vote, comment })));
}

export async function withdrawAgreement(projectId: string, id: string): Promise<{ agreement: Agreement }> {
  return handleApiResponse(await authFetch(`${one(projectId, id)}/withdraw`, jsonInit('POST')));
}

export async function decideAgreement(projectId: string, id: string, outcome: 'accept' | 'decline', note: string): Promise<{ agreement: Agreement }> {
  return handleApiResponse(await authFetch(`${one(projectId, id)}/decide`, jsonInit('POST', { outcome, note })));
}

export async function retryAgreementCommit(projectId: string, id: string): Promise<{ agreement: Agreement }> {
  return handleApiResponse(await authFetch(`${one(projectId, id)}/retry-commit`, jsonInit('POST')));
}

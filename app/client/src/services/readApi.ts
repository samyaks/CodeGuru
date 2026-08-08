import { handleApiResponse } from '../lib/api-error';

// "The Read" — typed client for /api/v2/projects/:id/read.
//
// GET is public (optionalAuth on the mount); every mutation requires an
// authenticated user and returns the SAME full payload shape as GET so the
// page can always replace its state wholesale. Mirrors intentApi.ts.

const API_BASE = '/api/v2';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

export type ReadClaimSlot = 'objective' | 'audience' | 'core_job';
export type ReadClaimStatus = 'drafted' | 'settled';
export type ReadClaimSource = 'inferred' | 'human';

export interface ReadEvidence {
  filePath: string | null;
  symbol: string | null;
  note: string | null;
}

export interface ReadAlternativeOption {
  id: string;
  label: string;
  detail: string;
  claimText: string;
}

export interface ReadAlternative {
  question: string;
  options: ReadAlternativeOption[];
}

export interface ReadClaim {
  id: string;
  slot: ReadClaimSlot;
  text: string;
  /** < 0.6 = uncertain → yellow wash + alternative UI. */
  confidence: number | null;
  status: ReadClaimStatus;
  source: ReadClaimSource;
  evidence: ReadEvidence[];
  alternative: ReadAlternative | null;
}

export interface ReadNext {
  title: string | null;
  why: string | null;
  category: string | null;
  /** null while gated — the server never sends the prompt text until unlock. */
  prompt: string | null;
  gated: boolean;
}

export interface ReadPayload {
  projectId: string;
  draftedAt: string | null;
  fileCount: number | null;
  claims: ReadClaim[];
  next: ReadNext;
  /** true when a correction stuck but the next-thing couldn't be re-derived. */
  nextStale?: boolean;
}

/** A correction: free text, or one of the claim's stored alternative options. */
export type ClaimCorrection = { text: string } | { optionId: string };

export async function fetchRead(projectId: string): Promise<ReadPayload> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/read`);
  return handleApiResponse<ReadPayload>(res);
}

export async function correctClaim(
  projectId: string,
  claimId: string,
  correction: ClaimCorrection,
): Promise<ReadPayload> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/read/claims/${claimId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(correction),
    },
  );
  return handleApiResponse<ReadPayload>(res);
}

/** Pro stub — flips the gate and returns the payload with next.prompt set. */
export async function unlockRead(projectId: string): Promise<ReadPayload> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/read/unlock`, {
    method: 'POST',
  });
  return handleApiResponse<ReadPayload>(res);
}

/** Re-run the read pipeline now. Settled claims survive by design. */
export async function regenerateRead(projectId: string): Promise<ReadPayload> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/read/regenerate`, {
    method: 'POST',
  });
  return handleApiResponse<ReadPayload>(res);
}

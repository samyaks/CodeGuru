import { handleApiResponse } from '../lib/api-error';
import type { GapData, GapStatus, Verification } from '../components/v2';

const API_BASE = '/api/v2';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

export interface V2Gap extends GapData {
  status: GapStatus;
  verification: Verification | null;
  rejectedReason: string | null;
  committedAt: string | null;
}

export interface V2GapsResponse {
  broken: V2Gap[];
  missing: V2Gap[];
  infra: V2Gap[];
}

export async function fetchV2Gaps(projectId: string, status?: string): Promise<V2GapsResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await authFetch(`${API_BASE}/projects/${projectId}/gaps${qs}`);
  return handleApiResponse<V2GapsResponse>(res);
}

async function postGapAction(
  projectId: string,
  gapId: string,
  action: 'accept' | 'reject' | 'restore' | 'mark-committed',
  body?: Record<string, unknown>,
): Promise<V2Gap> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/gaps/${gapId}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await handleApiResponse<{ gap: V2Gap }>(res);
  return data.gap;
}

export function acceptV2Gap(projectId: string, gapId: string): Promise<V2Gap> {
  return postGapAction(projectId, gapId, 'accept');
}

export function rejectV2Gap(projectId: string, gapId: string, reason?: string): Promise<V2Gap> {
  return postGapAction(projectId, gapId, 'reject', reason ? { reason } : undefined);
}

export function restoreV2Gap(projectId: string, gapId: string): Promise<V2Gap> {
  return postGapAction(projectId, gapId, 'restore');
}

export function markGapCommitted(projectId: string, gapId: string): Promise<V2Gap> {
  return postGapAction(projectId, gapId, 'mark-committed');
}

export async function refineV2Gap(
  projectId: string,
  gapId: string,
  instructions: string,
): Promise<V2Gap> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/gaps/${gapId}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instructions }),
  });
  const data = await handleApiResponse<{ gap: V2Gap }>(res);
  return data.gap;
}

// ── Shipped ────────────────────────────────────────────────────────

import type { ShippedItemData } from '../components/v2';

export interface V2ShippedResponse {
  repo: string | null;
  items: Array<ShippedItemData & {
    gapId: string | null;
    matchConfidence: number | null;
    matchStrategy: string | null;
  }>;
}

export async function fetchV2Shipped(projectId: string): Promise<V2ShippedResponse> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/shipped`);
  return handleApiResponse<V2ShippedResponse>(res);
}

export async function reopenShipped(projectId: string, itemId: string): Promise<{ newGapId: string }> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/shipped/${itemId}/reopen`, {
    method: 'POST',
  });
  return handleApiResponse<{ newGapId: string }>(res);
}

export interface BackfillSummary {
  ok: true;
  branch: string;
  total: number;
  processed: number;
  matched: number;
  skippedExisting: number;
  failed: number;
}

/**
 * Pull the project's recent GitHub commits and run them through the
 * gap-matcher → verifier pipeline, populating the Shipped tab with
 * historical activity. Idempotent — re-running will only process new
 * commits.
 */
export async function backfillShipped(
  projectId: string,
  opts: { limit?: number } = {},
): Promise<BackfillSummary> {
  const qs = opts.limit ? `?limit=${encodeURIComponent(String(opts.limit))}` : '';
  const res = await authFetch(`${API_BASE}/projects/${projectId}/shipped/backfill${qs}`, {
    method: 'POST',
  });
  return handleApiResponse<BackfillSummary>(res);
}


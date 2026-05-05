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


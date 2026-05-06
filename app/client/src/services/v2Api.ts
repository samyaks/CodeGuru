import { handleApiResponse } from '../lib/api-error';
import type { GapData, GapStatus, Verification } from '../components/v2';

const API_BASE = '/api/v2';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

/** A persona/job pair a gap blocks, attached server-side from the
 *  product map + persisted `v2_job_links` (or computed for synthetic
 *  map-derived gaps). May be `null` for the persona fields when the
 *  gap is linked to a job whose persona has been deleted since. */
export interface AffectedJob {
  jobId: string;
  jobTitle: string;
  personaId: string | null;
  personaName: string | null;
  personaEmoji: string | null;
  confidence: number | null;
  /** 'heuristic' | 'claude' | 'synthetic'. */
  method: string | null;
  reason: string | null;
}

export interface V2Gap extends GapData {
  status: GapStatus;
  verification: Verification | null;
  rejectedReason: string | null;
  committedAt: string | null;
  /** Always present in v2 responses. Empty array means "we tried, no
   *  jobs apply". The frontend treats `[]` and `undefined` differently:
   *  empty hides the badge row; undefined would mean "still being
   *  linked" (we don't currently emit that, but reserve the option). */
  affectedJobs?: AffectedJob[];
  /** 'ai' for persisted suggestions (the default), 'map' for gaps
   *  synthesized at request time from the product map's missing
   *  entities. `map` gaps don't have a cached prompt. */
  source?: 'ai' | 'map';
}

export interface GapsPersona {
  id: string;
  name: string;
  emoji: string;
}

export interface V2GapsResponse {
  broken: V2Gap[];
  missing: V2Gap[];
  infra: V2Gap[];
  /** Personas that have at least one job in the product map — used to
   *  populate the GapsSection persona filter chips. Empty array when
   *  the project has no map yet. */
  personas?: GapsPersona[];
}

export async function fetchV2Gaps(projectId: string, status?: string): Promise<V2GapsResponse> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await authFetch(`${API_BASE}/projects/${projectId}/gaps${qs}`);
  return handleApiResponse<V2GapsResponse>(res);
}

/** Fetch (or generate) the Cursor prompt for a gap. AI gaps have a
 *  cached prompt; synthetic map-derived gaps generate on demand. The UI
 *  calls this only when the user clicks "Get prompt" on a synthetic
 *  gap card so we don't burn Claude tokens for prompts no one reads. */
export async function fetchGapPrompt(projectId: string, gapId: string): Promise<string> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/gaps/${gapId}/prompt`, {
    method: 'POST',
  });
  const data = await handleApiResponse<{ prompt: string | null }>(res);
  return data.prompt ?? '';
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


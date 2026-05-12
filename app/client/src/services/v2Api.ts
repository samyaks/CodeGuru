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

// ── Security ───────────────────────────────────────────────────────

/** A single security finding rendered as a top risk in the security
 *  summary endpoint. Mirrors the V2Gap shape for the security-relevant
 *  fields plus the lifecycle status — the report view (Phase 3) can
 *  reuse this list directly without a second fetch. */
export interface SecurityTopRisk extends V2Gap {
  // No additional fields — V2Gap already carries isSecurity,
  // securitySeverity, cweId, securityDetector after Phase 2 slice (a).
}

export interface SecuritySummary {
  /** Live score, recomputed from current unaddressed security gaps on
   *  every request. Should equal `cachedScore` whenever the analysis
   *  is up-to-date — they diverge only briefly while a re-analysis
   *  is in flight or a triage just happened. */
  score: number;
  severityBreakdown: { critical: number; high: number; medium: number; low: number };
  totalUnaddressed: number;
  /** Last persisted score on `deployments.security_score`. Useful to
   *  cross-check against `score` when surfacing trends. Null on
   *  projects analyzed before migration 014. */
  cachedScore: number | null;
  topRisks: SecurityTopRisk[];
  /** Names of all detectors registered server-side, in the order
   *  they ran. Used by the report view to show "detected by" credits. */
  detectors: string[];
  lastAnalyzed: string | null;
}

export async function fetchSecuritySummary(projectId: string): Promise<SecuritySummary> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/security-summary`);
  return handleApiResponse<SecuritySummary>(res);
}

// ── Security report public share links (Phase 3 slice b) ───────────

/** A single share link as returned by the owner endpoints. The slug
 *  alone is enough to construct the public URL on the client; the
 *  server never exposes a fully-rendered URL because the canonical
 *  origin can change across environments. */
export interface SecurityShare {
  slug: string;
  redactRepo: boolean;
  expiresAt: string | null;
  createdAt: string;
}

export async function listSecurityShares(projectId: string): Promise<SecurityShare[]> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/security-shares`);
  const data = await handleApiResponse<{ shares: SecurityShare[] }>(res);
  return data.shares;
}

export async function createSecurityShare(
  projectId: string,
  options: { redactRepo?: boolean } = {},
): Promise<SecurityShare> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/security-shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redactRepo: !!options.redactRepo }),
  });
  const data = await handleApiResponse<{ share: SecurityShare }>(res);
  return data.share;
}

export async function revokeSecurityShare(slug: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/security-shares/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
  });
  await handleApiResponse<{ revoked: boolean; alreadyRevoked: boolean }>(res);
}

/** Project metadata as it appears in a public share. When the share's
 *  `redactRepo` is true, repo/repoUrl/framework/description are null
 *  and `name` is replaced with an opaque "Project · {hash}" tag. The
 *  caller doesn't need to know which mode the server returned — the
 *  fields are simply nullable in the redacted case. */
export interface SharedSecurityProject {
  name: string;
  repo: string | null;
  repoUrl: string | null;
  framework: string | null;
  description: string | null;
  lastAnalyzed: string | null;
}

/** Bundled payload returned by GET /api/v2/security-shared/:slug.
 *  Includes the full set of security gaps grouped by category so a
 *  shared client can render the "All security gaps" section without
 *  hitting the auth-gated /gaps endpoint. */
export interface SharedSecurityReport {
  share: SecurityShare;
  project: SharedSecurityProject;
  score: number;
  severityBreakdown: { critical: number; high: number; medium: number; low: number };
  totalUnaddressed: number;
  topRisks: SecurityTopRisk[];
  allSecurityGaps: { broken: V2Gap[]; missing: V2Gap[]; infra: V2Gap[] };
  detectors: string[];
}

/** No-auth fetch (no `credentials: include`). The endpoint is public,
 *  and shipping the auth cookie on a public link would be wasted work
 *  for the server. */
export async function fetchSharedSecurityReport(slug: string): Promise<SharedSecurityReport> {
  const res = await fetch(`${API_BASE}/security-shared/${encodeURIComponent(slug)}`);
  return handleApiResponse<SharedSecurityReport>(res);
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


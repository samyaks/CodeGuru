import { ApiError, handleApiResponse } from '../lib/api-error';

// Intent loop V1 — typed client for /api/v2/projects/:id/slice.
//
// Mirror of app/server/lib/slice-types.js; keep the two in step. Contract:
// docs/specs/intent-driven-building.md → "Shared contracts". GET is public
// (optionalAuth on the mount); every mutation requires a signed-in user and
// returns the full Slice so the card can replace its state wholesale.

const API_BASE = '/api/v2';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export type SliceStatus = 'active' | 'verifying' | 'verified' | 'abandoned';
export type CriterionStatus = 'pending' | 'met' | 'unmet' | 'unknown';
export type CriterionKind = 'feature' | 'regression';
export type SliceSourceKind = 'next_thing' | 'gap' | 'manual';
export type SyncMode = 'commit' | 'pr';

export interface AcceptanceCriterion {
  id: string;
  kind: CriterionKind;
  /** What a non-engineer checks. */
  description: string;
  /** What they should see. */
  expected_behavior: string;
  status: CriterionStatus;
  /** One line, from the verifier or the owner. */
  evidence: string | null;
  verified_by: 'verifier' | 'owner' | null;
  verified_at: string | null;
}

export interface SliceSource {
  kind: SliceSourceKind;
  /** Gap id when kind === 'gap'. */
  id: string | null;
  /** What the owner typed when kind === 'manual'. */
  text: string | null;
}

export interface SliceSync {
  /** 'commit' = written straight to the branch; 'pr' = branch protection forced a PR. */
  mode: SyncMode | null;
  commit_sha: string | null;
  pr_url: string | null;
  pr_number: number | null;
  /** Which rules file received the pointer block (CLAUDE.md, AGENTS.md, .cursor/rules/…). */
  rules_file: string | null;
  synced_at: string | null;
}

export interface SliceStaging {
  tested: boolean;
  url: string | null;
}

export interface SlicePushes {
  last_seen_at: string | null;
  /** Files that violated protected_paths on the latest push. Non-empty → warning strip. */
  guardrail_touched: string[];
}

export interface Slice {
  id: string;
  project_id: string;
  status: SliceStatus;
  source: SliceSource;
  title: string;
  objective: string;
  why: string | null;
  /** "components/Login.tsx — email form, no submit handler". Shown as "Already there". */
  existing: string[];
  guardrails: string[];
  /** Repo-relative globs. Shown as "Don't touch". */
  protected_paths: string[];
  /** The last one is normally the default regression criterion (kind: 'regression'). */
  acceptance_criteria: AcceptanceCriterion[];
  /** The text behind "Copy prompt". Already rendered server-side. */
  prompt: string;
  /** The branch the builder pushes to; defaults to the repo's default branch. */
  branch: string;
  sync: SliceSync;
  staging: SliceStaging;
  pushes: SlicePushes;
  activated_at: string;
  verified_at: string | null;
}

export interface SlicePayload {
  active: Slice | null;
  /** Last 5 verified/abandoned, newest first. */
  recent: Slice[];
}

export type ActivateSliceBody =
  | { source: 'next_thing' }
  | { source: 'gap'; gapId: string }
  | { source: 'manual'; text: string };

export interface SyncPreviewFile {
  path: string;
  action: 'create' | 'update';
  content: string;
}

export interface SyncPreview {
  branch: string;
  files: SyncPreviewFile[];
}

export type OwnerCriterionStatus = Extract<CriterionStatus, 'met' | 'unmet' | 'pending'>;

/** Longest objective the "What do you want to get working next?" box accepts. */
export const MANUAL_TEXT_MAX = 500;

/** True when the server said the GitHub token lacks `repo` (424 NEEDS_RECONNECT). */
export function isNeedsReconnect(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'NEEDS_RECONNECT' || err.status === 424);
}

/** True while an endpoint is still an Agent 0 stub. Lets the card degrade quietly. */
export function isNotImplemented(err: unknown): boolean {
  return err instanceof ApiError && (err.code === 'NOT_IMPLEMENTED' || err.status === 501);
}

export async function fetchSlice(projectId: string): Promise<SlicePayload> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/slice`);
  return handleApiResponse<SlicePayload>(res);
}

/** 409 CONFLICT when a slice is already active. */
export async function activateSlice(projectId: string, body: ActivateSliceBody): Promise<Slice> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/slice/activate`, jsonInit('POST', body));
  return handleApiResponse<Slice>(res);
}

/** What "Add to repo" would commit; show before confirming. */
export async function previewSliceSync(projectId: string, sliceId: string): Promise<SyncPreview> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/slice/${sliceId}/sync/preview`);
  return handleApiResponse<SyncPreview>(res);
}

/** Writes .intent/active.json + the rules-file block. Throws 424 → isNeedsReconnect(). */
export async function syncSlice(projectId: string, sliceId: string, branch?: string): Promise<Slice> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/slice/${sliceId}/sync`,
    jsonInit('POST', branch ? { branch } : {}),
  );
  return handleApiResponse<Slice>(res);
}

/** Owner override of one criterion's verdict. */
export async function setSliceCriterion(
  projectId: string,
  sliceId: string,
  criterionId: string,
  status: OwnerCriterionStatus,
  note?: string,
): Promise<Slice> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/slice/${sliceId}/criteria/${criterionId}`,
    jsonInit('POST', note ? { status, note } : { status }),
  );
  return handleApiResponse<Slice>(res);
}

export async function setSliceStaging(
  projectId: string,
  sliceId: string,
  tested: boolean,
  url?: string,
): Promise<Slice> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/slice/${sliceId}/staging`,
    jsonInit('POST', url ? { tested, url } : { tested }),
  );
  return handleApiResponse<Slice>(res);
}

/** Manual verification against the latest commits on slice.branch (no webhook needed). */
export async function checkSlice(projectId: string, sliceId: string): Promise<Slice> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/slice/${sliceId}/check`, jsonInit('POST'));
  return handleApiResponse<Slice>(res);
}

export async function abandonSlice(projectId: string, sliceId: string, reason?: string): Promise<Slice> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/slice/${sliceId}/abandon`,
    jsonInit('POST', reason ? { reason } : {}),
  );
  return handleApiResponse<Slice>(res);
}

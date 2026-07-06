import { handleApiResponse } from '../lib/api-error';

// Takeoff intent substrate — shared frontend contract (Wave 0 foundation).
//
// These types define the API surface between the Context-tab UI (built
// against a mock in Wave 1) and the backend handlers (Phase 4/4b/5). Keep
// this file the single source of truth for the intent JSON shapes so the
// frontend and backend agents stay in sync. Mirrors v2Api.ts conventions.

const API_BASE = '/api/v2';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

export type IntentKind = 'behavior' | 'constraint' | 'non_goal';
export type IntentStatus = 'candidate' | 'confirmed' | 'rejected';
export type IntentSource = 'inferred' | 'human';
export type LinkStatus = 'healthy' | 'needs_relink' | 'broken';

/** A code anchor a statement is grounded in. `symbol` is an exported
 *  function/class/route handler/model name, or null for file-level links.
 *  `suggestedSymbol` is populated by Phase 5 reconciliation when
 *  link_status is 'needs_relink'. */
export interface IntentLink {
  filePath: string;
  symbol: string | null;
  linkStatus: LinkStatus;
  suggestedSymbol?: string | null;
}

export interface IntentStatement {
  id: string;
  text: string;
  kind: IntentKind;
  status: IntentStatus;
  source: IntentSource;
  featureArea: string | null;
  groupLabel?: string | null;
  scope?: 'job' | 'global';
  confidence?: number | null;
  confirmedVia?: 'direct' | 'job' | null;
  links: IntentLink[];
  satisfied: boolean | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface IntentJobGroup {
  id: string;
  title: string;
  priority: string;
  confirmed: boolean;
  statements: IntentStatement[];
  candidateCount: number;
  confirmedCount: number;
  rejectedCount: number;
  holdsCount: number;
  brokenCount: number;
}

export interface IntentPersonaGroup {
  id: string;
  name: string;
  emoji: string | null;
  description?: string | null;
  confirmed: boolean;
  jobs: IntentJobGroup[];
  candidateCount: number;
  confirmedCount: number;
  rejectedCount: number;
  holdsCount: number;
  brokenCount: number;
}

export interface IntentGlobalsGroup {
  title: string;
  statements: IntentStatement[];
  candidateCount: number;
  confirmedCount: number;
  rejectedCount: number;
  holdsCount: number;
  brokenCount: number;
}

export interface IntentListResponse {
  personas: IntentPersonaGroup[];
  globals: IntentGlobalsGroup;
  total: number;
  confirmed: number;
  candidates: number;
  rejected: number;
  holds: number;
  broken: number;
}

/** @deprecated legacy area grouping — kept for mock/back-compat only */
export interface IntentAreaGroup {
  featureArea: string | null;
  statements: IntentStatement[];
  candidateCount: number;
  confirmedCount: number;
  rejectedCount: number;
}

/** A link flagged by Phase 5 reconciliation as needing human adjudication. */
export interface IntentTriageItem {
  statementId: string;
  statementText: string;
  featureArea: string | null;
  link: IntentLink;
}

export interface IntentEditPayload {
  text?: string;
  kind?: IntentKind;
  links?: Array<{ filePath: string; symbol: string | null }>;
}

/** Identifies a specific link on a statement by its current (filePath, symbol). */
export interface IntentLinkRef {
  filePath: string;
  symbol: string | null;
}

/** Payload to reconcile a needs_relink link. Omit newSymbol/newFilePath to
 *  accept the reconciler's suggestedSymbol. */
export interface IntentRelinkPayload extends IntentLinkRef {
  newSymbol?: string | null;
  newFilePath?: string;
}

/** A gap synthesized (Phase 6) from a confirmed statement whose linked code no
 *  longer satisfies it. Computed fresh on read — never stored. `id` is
 *  `intent-<statementId>` so the Gaps surface can route it distinctly. */
export interface IntentGap {
  id: string;
  statementId: string;
  title: string;
  description: string;
  kind: IntentKind;
  featureArea: string | null;
  links: IntentLink[];
  /** Why it surfaced: 'unsatisfied' (code drifted) or 'broken_link'. */
  reason: 'unsatisfied' | 'broken_link';
  lastCheckedAt: string | null;
}

// ── Client functions (Phase 4/4b/5 implement the backends) ────────

export async function fetchIntent(
  projectId: string,
  opts: { status?: IntentStatus; featureArea?: string } = {},
): Promise<IntentListResponse> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set('status', opts.status);
  if (opts.featureArea) qs.set('featureArea', opts.featureArea);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const res = await authFetch(`${API_BASE}/projects/${projectId}/intent${suffix}`);
  return handleApiResponse<IntentListResponse>(res);
}

export async function confirmStatement(
  projectId: string,
  statementId: string,
): Promise<IntentStatement> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/intent/${statementId}/confirm`,
    { method: 'POST' },
  );
  const data = await handleApiResponse<{ statement: IntentStatement }>(res);
  return data.statement;
}

export async function editStatement(
  projectId: string,
  statementId: string,
  payload: IntentEditPayload,
): Promise<IntentStatement> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/intent/${statementId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const data = await handleApiResponse<{ statement: IntentStatement }>(res);
  return data.statement;
}

export async function rejectStatement(
  projectId: string,
  statementId: string,
): Promise<IntentStatement> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/intent/${statementId}/reject`,
    { method: 'POST' },
  );
  const data = await handleApiResponse<{ statement: IntentStatement }>(res);
  return data.statement;
}

export async function restoreStatement(
  projectId: string,
  statementId: string,
): Promise<IntentStatement> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/intent/${statementId}/restore`,
    { method: 'POST' },
  );
  const data = await handleApiResponse<{ statement: IntentStatement }>(res);
  return data.statement;
}

/** Living spec (Phase 4b): generated markdown from confirmed statements. */
export async function fetchIntentSpec(projectId: string): Promise<string> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/intent/spec`);
  const data = await handleApiResponse<{ markdown: string }>(res);
  return data.markdown ?? '';
}

/** Link triage list (Phase 5). */
export async function fetchIntentTriage(projectId: string): Promise<IntentTriageItem[]> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/intent/triage`);
  const data = await handleApiResponse<{ items: IntentTriageItem[] }>(res);
  return data.items ?? [];
}

/** Apply a relink (Phase 5): repoint a needs_relink link at a real symbol. */
export async function applyRelink(
  projectId: string,
  statementId: string,
  payload: IntentRelinkPayload,
): Promise<IntentStatement> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/intent/${statementId}/relink`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  const data = await handleApiResponse<{ statement: IntentStatement }>(res);
  return data.statement;
}

/** Confirm a link is genuinely broken (Phase 5): the code it described is gone. */
export async function markLinkBroken(
  projectId: string,
  statementId: string,
  link: IntentLinkRef,
): Promise<IntentStatement> {
  const res = await authFetch(
    `${API_BASE}/projects/${projectId}/intent/${statementId}/mark-broken`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(link),
    },
  );
  const data = await handleApiResponse<{ statement: IntentStatement }>(res);
  return data.statement;
}

export async function fetchIntentFindings(projectId: string): Promise<IntentFinding[]> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/intent/findings`);
  const data = await handleApiResponse<{ findings: IntentFinding[] }>(res);
  return data.findings ?? [];
}

/** Broken guarantees (findings-first UX). */
export interface IntentFinding {
  id: string;
  statementId: string;
  title: string;
  description: string;
  kind: IntentKind;
  scope: 'job' | 'global';
  status: IntentStatus;
  featureArea: string | null;
  links: IntentLink[];
  reason: 'broken';
  confidence: number | null;
}

/** Intent gaps (Phase 6): confirmed statements whose code drifted. */
export async function fetchIntentGaps(projectId: string): Promise<IntentGap[]> {
  const res = await authFetch(`${API_BASE}/projects/${projectId}/intent/gaps`);
  const data = await handleApiResponse<{ gaps: IntentGap[] }>(res);
  return data.gaps ?? [];
}

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
  links: IntentLink[];
  /** Satisfaction (Phase 6). `null` = not yet checked / no baseline. */
  satisfied: boolean | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

/** Statements for one feature area, plus review progress for the UI. */
export interface IntentAreaGroup {
  featureArea: string | null;
  statements: IntentStatement[];
  candidateCount: number;
  confirmedCount: number;
  rejectedCount: number;
}

export interface IntentListResponse {
  areas: IntentAreaGroup[];
  total: number;
  confirmed: number;
  candidates: number;
  rejected: number;
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

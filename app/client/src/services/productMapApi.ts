import { handleApiResponse } from '../lib/api-error';

const API = '/api';

function authFetch(url: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, credentials: 'include' });
}

/** Normalized product map (flexible to snake_case API). */
export interface ProductMapData {
  id: string;
  projectId: string;
  projectName?: string;
  description?: string;
  domain?: string;
  personas: {
    id: string;
    name: string;
    emoji?: string;
    description?: string;
    confirmed?: boolean;
  }[];
  jobs: {
    id: string;
    personaId: string;
    title: string;
    priority: 'high' | 'medium' | 'low' | string;
    weight: number;
    confirmed?: boolean;
  }[];
  entities: {
    id: string;
    type: string;
    key: string;
    label: string;
    filePath?: string;
    file_path?: string;
    status: string;
    module?: string | null;
    metadata?: Record<string, unknown>;
  }[];
  edges: {
    id?: string;
    fromId?: string;
    toId?: string;
    from_id?: string;
    to_id?: string;
    from?: string;
    to?: string;
    type: string;
    label?: string;
  }[];
  /** If API sends precomputed scores */
  appScore?: number;
  scores?: {
    app?: number;
    job?: Record<string, number>;
    persona?: Record<string, number>;
  };
  moduleRanking?: {
    module: string;
    before: number;
    after: number;
    delta: number;
    capLabel?: string;
    capStatus?: string;
  }[];
}

export interface SimulateResult {
  before: number;
  after: number;
  delta: number;
  jobScores: Record<string, number>;
  personaScores: Record<string, number>;
  jobsUnblocked: { id: string; title: string; before: number; after: number }[];
}

function pickString(v: unknown, alt?: unknown): string | undefined {
  if (typeof v === 'string' && v) return v;
  if (typeof alt === 'string' && alt) return alt;
  return undefined;
}

function normalizeEntity(e: Record<string, unknown>) {
  return {
    id: String(e.id),
    type: String(e.type ?? 'unknown'),
    key: String(e.key ?? ''),
    label: String(e.label ?? e.key ?? ''),
    filePath: pickString(e.filePath, e.file_path),
    file_path: pickString(e.file_path, e.filePath),
    status: String(e.status ?? 'none'),
    module: (e.module as string) ?? null,
    metadata: (e.metadata as Record<string, unknown>) || {},
  };
}

function normalizeEdge(e: Record<string, unknown>) {
  const fromId = pickString(e.fromId, e.from_id) ?? pickString(e.from) ?? '';
  const toId = pickString(e.toId, e.to_id) ?? pickString(e.to) ?? '';
  return {
    id: e.id != null ? String(e.id) : undefined,
    fromId,
    toId,
    type: String(e.type ?? 'needs'),
    label: e.label != null ? String(e.label) : undefined,
  };
}

function normalizeMapPayload(raw: Record<string, unknown>): ProductMapData {
  const id = String(raw.id ?? raw.map_id ?? '');
  const projectId = String(raw.projectId ?? raw.project_id ?? '');

  const personas = Array.isArray(raw.personas)
    ? raw.personas.map((p) => {
        const o = p as Record<string, unknown>;
        return {
          id: String(o.id),
          name: String(o.name ?? ''),
          emoji: o.emoji != null ? String(o.emoji) : '👤',
          description: o.description != null ? String(o.description) : undefined,
          confirmed: Boolean(o.confirmed),
        };
      })
    : [];

  const jobs = Array.isArray(raw.jobs)
    ? raw.jobs.map((j) => {
        const o = j as Record<string, unknown>;
        const pr = o.priority != null ? String(o.priority) : 'medium';
        const w = o.weight;
        const weight =
          typeof w === 'number'
            ? w
            : pr === 'high'
              ? 3
              : pr === 'low'
                ? 1
                : 2;
        return {
          id: String(o.id),
          personaId: String(o.personaId ?? o.persona_id ?? ''),
          title: String(o.title ?? ''),
          priority: pr as 'high' | 'medium' | 'low',
          weight,
          confirmed: Boolean(o.confirmed),
        };
      })
    : [];

  const entities = Array.isArray(raw.entities)
    ? (raw.entities as Record<string, unknown>[]).map(normalizeEntity)
    : [];

  const edges = Array.isArray(raw.edges)
    ? (raw.edges as Record<string, unknown>[]).map(normalizeEdge)
    : [];

  const scores = raw.scores as Record<string, unknown> | undefined;
  const appScore =
    typeof raw.appScore === 'number'
      ? raw.appScore
      : typeof raw.app_score === 'number'
        ? raw.app_score
        : typeof scores?.app === 'number'
          ? scores.app
          : undefined;

  const moduleRanking = Array.isArray(raw.moduleRanking)
    ? (raw.moduleRanking as Record<string, unknown>[]).map((m) => ({
        module: String(m.module),
        before: Number(m.before ?? 0),
        after: Number(m.after ?? 0),
        delta: Number(m.delta ?? 0),
        capLabel: m.capLabel != null ? String(m.capLabel) : m.cap_label != null ? String(m.cap_label) : undefined,
        capStatus: m.capStatus != null ? String(m.capStatus) : m.cap_status != null ? String(m.cap_status) : undefined,
      }))
    : Array.isArray(raw.module_ranking)
      ? (raw.module_ranking as Record<string, unknown>[]).map((m) => ({
          module: String(m.module),
          before: Number(m.before ?? 0),
          after: Number(m.after ?? 0),
          delta: Number(m.delta ?? 0),
        }))
      : undefined;

  return {
    id,
    projectId,
    projectName: pickString(raw.projectName, raw.project_name),
    description: pickString(raw.description),
    domain: pickString(raw.domain),
    personas,
    jobs,
    entities,
    edges,
    appScore,
    scores: scores
      ? {
          app: typeof scores.app === 'number' ? scores.app : appScore,
          job: (scores.job as Record<string, number>) || (scores.jobs as Record<string, number>),
          persona: (scores.persona as Record<string, number>) || (scores.personas as Record<string, number>),
        }
      : undefined,
    moduleRanking,
  };
}

/**
 * Server sends `{ map: { id, projectId, scores, ... }, personas, jobs, entities, edges }`.
 * Merging is required — `map` alone does not include graph arrays.
 */
function normalizeFromMapEnvelope(data: Record<string, unknown>): ProductMapData | null {
  if (data.map === null) return null;

  if (data.map && typeof data.map === 'object' && !Array.isArray(data.map)) {
    const inner = data.map as Record<string, unknown>;
    return normalizeMapPayload({
      ...inner,
      personas: data.personas ?? inner.personas,
      jobs: data.jobs ?? inner.jobs,
      entities: data.entities ?? inner.entities,
      edges: data.edges ?? inner.edges,
      moduleRanking: data.moduleRanking ?? data.module_ranking ?? inner.moduleRanking,
      appScore: data.appScore ?? data.app_score ?? inner.appScore,
    });
  }

  return normalizeMapPayload(data);
}

/**
 * GET /api/product-map/:projectId — latest map for the project.
 * Returns null if 404 (no map yet).
 */
export async function fetchProductMap(projectId: string): Promise<ProductMapData | null> {
  const res = await authFetch(`${API}/product-map/${projectId}`);
  if (res.status === 404) return null;
  const data = (await handleApiResponse(res)) as Record<string, unknown>;
  return normalizeFromMapEnvelope(data);
}

/**
 * GET /api/product-map/:mapId/simulate/:moduleId
 */
export async function fetchSimulate(
  mapId: string,
  moduleId: string,
): Promise<SimulateResult> {
  const res = await authFetch(
    `${API}/product-map/${mapId}/simulate/${encodeURIComponent(moduleId)}`,
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Simulate failed (${res.status})`);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const jobScores = (raw.jobScores ?? raw.job_scores) as Record<string, number> | undefined;
  const personaScores = (raw.personaScores ?? raw.persona_scores) as
    | Record<string, number>
    | undefined;
  return {
    before: Number(raw.before ?? 0),
    after: Number(raw.after ?? 0),
    delta: Number(raw.delta ?? 0),
    jobScores: jobScores && typeof jobScores === 'object' ? jobScores : {},
    personaScores: personaScores && typeof personaScores === 'object' ? personaScores : {},
    jobsUnblocked: Array.isArray(raw.jobsUnblocked)
      ? (raw.jobsUnblocked as Record<string, unknown>[]).map((j) => ({
          id: String(j.id),
          title: String(j.title),
          before: Number(j.before),
          after: Number(j.after),
        }))
      : Array.isArray(raw.jobs_unblocked)
        ? (raw.jobs_unblocked as Record<string, unknown>[]).map((j) => ({
            id: String(j.id),
            title: String(j.title),
            before: Number(j.before),
            after: Number(j.after),
          }))
        : [],
  };
}

/**
 * POST /api/product-map/:projectId — create map from description
 * Body: { analysisId, description }
 */
export async function createProductMap(
  projectId: string,
  body: { analysisId: string; description: string },
): Promise<ProductMapData> {
  const res = await authFetch(`${API}/product-map/${projectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await handleApiResponse(res)) as Record<string, unknown>;
  return normalizeFromMapEnvelope(data) ?? normalizeMapPayload(data);
}

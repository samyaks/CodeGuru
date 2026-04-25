/**
 * Client-side job readiness scoring (mirrors app/server/services/job-scorer.js)
 * for display when the API omits precomputed scores.
 */

export type MapEdge = { fromId?: string; toId?: string; from?: string; to?: string; type: string };
export type MapEntity = {
  id: string;
  status?: string;
  module?: string | null;
  label?: string;
  [k: string]: unknown;
};
export type MapJob = {
  id: string;
  personaId: string;
  title: string;
  priority?: string;
  weight?: number;
};

function edgeFromId(e: MapEdge) {
  return e.fromId != null ? e.fromId : e.from;
}

function edgeToId(e: MapEdge) {
  return e.toId != null ? e.toId : e.to;
}

export function getEntityStatus(entityId: string, entities: MapEntity[]) {
  const entity = entities.find((x) => x.id === entityId);
  if (!entity) return 0;
  switch (entity.status) {
    case 'detected':
    case 'confirmed':
    case 'full':
      return 1;
    case 'partial':
    case 'stub':
      return 0.4;
    default:
      return 0;
  }
}

export function scoreJob(jobId: string, entities: MapEntity[], edges: MapEdge[]) {
  const needs = edges.filter(
    (e) => e && edgeFromId(e) === jobId && e.type === 'needs',
  );
  if (needs.length === 0) return 0;
  const total = needs.reduce(
    (sum, e) => sum + getEntityStatus(String(edgeToId(e)), entities),
    0,
  );
  return Math.round((total / needs.length) * 100);
}

export function scoreApp(jobs: MapJob[], entities: MapEntity[], edges: MapEdge[]) {
  const totalWeight = jobs.reduce(
    (s, j) => s + (j.weight != null ? j.weight : 2),
    0,
  );
  if (totalWeight === 0) return 0;
  const weighted = jobs.reduce((s, j) => {
    const w = j.weight != null ? j.weight : 2;
    return s + (scoreJob(j.id, entities, edges) / 100) * w;
  }, 0);
  return Math.round((weighted / totalWeight) * 100);
}

export function scorePersona(
  personaId: string,
  jobs: MapJob[],
  entities: MapEntity[],
  edges: MapEdge[],
) {
  const pJobs = jobs.filter((j) => j.personaId === personaId);
  if (pJobs.length === 0) return 0;
  const avg =
    pJobs.reduce((s, j) => s + scoreJob(j.id, entities, edges), 0) / pJobs.length;
  return Math.round(avg);
}

export function simulateModule(
  moduleId: string,
  jobs: MapJob[],
  entities: MapEntity[],
  edges: MapEdge[],
) {
  const cap = entities.find((e) => e.module === moduleId);
  if (!cap) {
    const before = scoreApp(jobs, entities, edges);
    return { before, after: before, delta: 0, jobsUnblocked: [] as { id: string; title: string; before: number; after: number }[] };
  }

  const simEntities = entities.map((e) =>
    e.id === cap.id ? { ...e, status: 'full' as const } : e,
  );

  const before = scoreApp(jobs, entities, edges);
  const after = scoreApp(jobs, simEntities, edges);

  const jobsUnblocked = jobs
    .filter(
      (j) =>
        scoreJob(j.id, simEntities, edges) > scoreJob(j.id, entities, edges),
    )
    .map((j) => ({
      id: j.id,
      title: j.title,
      before: scoreJob(j.id, entities, edges),
      after: scoreJob(j.id, simEntities, edges),
    }));

  return { before, after, delta: after - before, jobsUnblocked };
}

export function rankModules(jobs: MapJob[], entities: MapEntity[], edges: MapEdge[]) {
  const modules = [
    ...new Set(entities.filter((e) => e.module).map((e) => e.module as string)),
  ];
  return modules
    .map((m) => ({ module: m, ...simulateModule(m, jobs, entities, edges) }))
    .sort((a, b) => b.delta - a.delta);
}

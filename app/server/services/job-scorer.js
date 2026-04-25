/**
 * Job-based readiness scoring (pure functions).
 */

function getEntityStatus(entityId, entities) {
  const entity = entities.find((e) => e.id === entityId);
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

function scoreJob(jobId, entities, edges) {
  const needs = edges.filter((e) => e.fromId === jobId && e.type === 'needs');
  if (needs.length === 0) return 0;
  const total = needs.reduce((sum, e) => sum + getEntityStatus(e.toId, entities), 0);
  return Math.round((total / needs.length) * 100);
}

function scoreApp(jobs, entities, edges) {
  const totalWeight = jobs.reduce((s, j) => s + (j.weight || 2), 0);
  if (totalWeight === 0) return 0;
  const weighted = jobs.reduce((s, j) => {
    return s + (scoreJob(j.id, entities, edges) / 100) * (j.weight || 2);
  }, 0);
  return Math.round((weighted / totalWeight) * 100);
}

function scorePersona(personaId, jobs, entities, edges) {
  const pJobs = jobs.filter((j) => j.personaId === personaId);
  if (pJobs.length === 0) return 0;
  const avg = pJobs.reduce((s, j) => s + scoreJob(j.id, entities, edges), 0) / pJobs.length;
  return Math.round(avg);
}

function simulateModule(moduleId, jobs, entities, edges) {
  const cap = entities.find((e) => e.module === moduleId);
  if (!cap) {
    const before = scoreApp(jobs, entities, edges);
    return { before, after: before, delta: 0, jobsUnblocked: [] };
  }

  const simEntities = entities.map((e) =>
    (e.id === cap.id ? { ...e, status: 'full' } : e)
  );

  const before = scoreApp(jobs, entities, edges);
  const after = scoreApp(jobs, simEntities, edges);

  const jobsUnblocked = jobs
    .filter((j) => scoreJob(j.id, simEntities, edges) > scoreJob(j.id, entities, edges))
    .map((j) => ({
      id: j.id,
      title: j.title,
      before: scoreJob(j.id, entities, edges),
      after: scoreJob(j.id, simEntities, edges),
    }));

  return { before, after, delta: after - before, jobsUnblocked };
}

function rankModules(jobs, entities, edges) {
  const modules = [...new Set(entities.filter((e) => e.module).map((e) => e.module))];
  return modules
    .map((m) => ({ module: m, ...simulateModule(m, jobs, entities, edges) }))
    .sort((a, b) => b.delta - a.delta);
}

function scoreJobReadiness(jobs, entities, edges) {
  return scoreApp(jobs, entities, edges);
}

function buildScoresObject(jobs, entities, edges) {
  const app = scoreApp(jobs, entities, edges);
  const byPersona = {};
  for (const pid of [...new Set(jobs.map((j) => j.personaId).filter(Boolean))]) {
    byPersona[pid] = scorePersona(pid, jobs, entities, edges);
  }
  const byJob = {};
  for (const j of jobs) {
    byJob[j.id] = scoreJob(j.id, entities, edges);
  }
  return {
    app,
    persona: byPersona,
    job: byJob,
    moduleRanking: rankModules(jobs, entities, edges),
  };
}

module.exports = {
  getEntityStatus,
  scoreJob,
  scoreApp,
  scoreJobReadiness,
  scorePersona,
  simulateModule,
  rankModules,
  buildScoresObject,
};

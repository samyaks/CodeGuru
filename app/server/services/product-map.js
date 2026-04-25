const crypto = require('crypto');
const { analyses, deployments, productMap: mapDb } = require('../lib/db');
const { checkProjectAccess, safeParseJson } = require('../lib/helpers');
const { AppError } = require('../lib/app-error');

const { extractCodeEntities } = require('./code-entities');
const { extractProductIntent } = require('./map-extractor');
const { linkAll } = require('./map-linker');
const { buildScoresObject } = require('./job-scorer');

function weightFromPriority(p) {
  if (p === 'high') return 3;
  if (p === 'low') return 1;
  return 2;
}

function buildCodebaseModel(analysis) {
  let m = analysis?.analysis;
  if (typeof m === 'string') m = safeParseJson(m, null);
  if (m && (Array.isArray(m.fileTree) || m.fileTree) && m.gaps) {
    return m;
  }
  if (m && m.stack && m.fileTree) {
    return m;
  }
  return null;
}

async function loadCodebaseModel(projectId, analysisId) {
  const [analysis, deployment] = await Promise.all([
    analyses.findById(analysisId),
    deployments.findById(projectId),
  ]);
  if (!analysis) {
    throw AppError.notFound('Analysis not found');
  }

  const fromAnalysis = buildCodebaseModel(analysis);
  if (fromAnalysis) return fromAnalysis;

  const ad = deployment?.analysis_data
    ? (typeof deployment.analysis_data === 'string'
      ? safeParseJson(deployment.analysis_data, {})
      : deployment.analysis_data)
    : {};

  return {
    meta: {
      name: deployment?.repo || analysis.repo,
      description: deployment?.description || ad.meta?.description,
    },
    stack: deployment?.stack_info || ad.stack || {},
    fileTree: ad.fileTree || [],
    fileContents: ad.fileContents || {},
    gaps: ad.gaps || {},
    features: ad.features || [],
    structure: ad.structure || {},
    deployInfo: ad.deployInfo || {},
    fileContentsPartial: !ad.fileContents,
  };
}

function remapProductNodes(personas, jobs) {
  const idMap = new Map();
  const newPersonas = personas.map((p) => {
    const nid = crypto.randomUUID();
    idMap.set(p.id, nid);
    return { ...p, id: nid };
  });
  const newJobs = jobs
    .map((j) => {
      const pid = idMap.get(j.personaId) || (personas.length ? newPersonas[0].id : null);
      if (!pid) return null;
      return {
        ...j,
        id: crypto.randomUUID(),
        personaId: pid,
      };
    })
    .filter(Boolean);

  return { personas: newPersonas, jobs: newJobs };
}

function graphFromDbRow(full) {
  const { personas, jobs, entities, edges } = full;
  return {
    personas: personas.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      emoji: p.emoji,
      confirmed: p.confirmed,
      sortOrder: p.sort_order,
    })),
    jobs: jobs.map((j) => ({
      id: j.id,
      personaId: j.persona_id,
      title: j.title,
      priority: j.priority,
      weight: j.weight,
      confirmed: j.confirmed,
      sortOrder: j.sort_order,
    })),
    entities: entities.map((e) => ({
      id: e.id,
      type: e.type,
      key: e.key,
      label: e.label,
      filePath: e.file_path,
      status: e.status,
      module: e.module,
      metadata: e.metadata || {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      fromId: e.from_id,
      toId: e.to_id,
      type: e.type,
      label: e.label,
      confidence: e.confidence,
      method: e.method,
      createdAt: e.created_at,
    })),
  };
}

function computeScoresFromGraph(g) {
  return buildScoresObject(g.jobs, g.entities, g.edges);
}

/**
 * map_entities.id is a global PRIMARY KEY (not scoped by map_id). Code entities
 * use stable logical ids (e.g. cap:auth, page:/dashboard). Remap to UUIDs per
 * map insert and rewrite edges so second+ maps for the same repo do not collide.
 */
function remapEntityIdsForPersistence(entities, edges) {
  if (!entities || entities.length === 0) {
    return { entities: entities || [], edges: edges || [] };
  }
  const idMap = new Map();
  for (const e of entities) {
    idMap.set(e.id, crypto.randomUUID());
  }
  const newEntities = entities.map((e) => ({
    ...e,
    id: idMap.get(e.id),
    metadata: {
      ...(e.metadata && typeof e.metadata === 'object' ? e.metadata : {}),
      logicalEntityId: e.id,
    },
  }));
  const newEdges = (edges || []).map((edge) => ({
    ...edge,
    fromId: idMap.has(edge.fromId) ? idMap.get(edge.fromId) : edge.fromId,
    toId: idMap.has(edge.toId) ? idMap.get(edge.toId) : edge.toId,
  }));
  return { entities: newEntities, edges: newEdges };
}

async function createProductMap(projectId, analysisId, description, { req } = {}) {
  if (!description || !String(description).trim()) {
    throw AppError.badRequest('description is required');
  }
  const deployment = await deployments.findById(projectId);
  if (!deployment) throw AppError.notFound('Project not found');
  if (req) checkProjectAccess(deployment, req);

  const codebaseModel = await loadCodebaseModel(projectId, analysisId);

  const intent = await extractProductIntent(description, analysisId);
  let { personas, jobs } = remapProductNodes(intent.personas, intent.jobs);
  if (personas.length === 0) {
    personas = [{
      id: crypto.randomUUID(),
      name: 'User',
      description: 'End user',
      emoji: '👤',
      confirmed: false,
    }];
  }
  if (jobs.length === 0) {
    jobs = [{
      id: crypto.randomUUID(),
      personaId: personas[0].id,
      title: 'Use the application',
      priority: 'medium',
      weight: 2,
      confirmed: false,
    }];
  }

  const entitiesLogical = extractCodeEntities(codebaseModel);
  const edgesLogical = await linkAll(jobs, entitiesLogical, codebaseModel, analysisId);
  const scores = buildScoresObject(jobs, entitiesLogical, edgesLogical);
  const { entities, edges } = remapEntityIdsForPersistence(entitiesLogical, edgesLogical);

  const mapId = crypto.randomUUID();
  const sortP = personas.map((p, i) => ({ ...p, sort_order: i }));
  const mapJobs = jobs.map((j, i) => ({ ...j, sort_order: i }));

  await mapDb.createProductMapWithGraph({
    map: {
      id: mapId,
      project_id: projectId,
      analysis_id: analysisId,
      description,
      domain: intent.domain,
    },
    personas: sortP,
    jobs: mapJobs,
    entities,
    edges,
    scores,
  });

  return {
    mapId,
    projectId,
    analysisId,
    description,
    domain: intent.domain,
    personas: sortP,
    jobs: mapJobs,
    entities,
    edges,
    scores,
  };
}

async function recomputeAndPersist(mapId) {
  const full = await mapDb.getProductMap(mapId);
  if (!full) return null;
  const g = graphFromDbRow(full);
  const scores = computeScoresFromGraph(g);
  await mapDb.updateMapScores(mapId, scores);
  return { ...full, map: { ...full.map, scores }, graph: g, scores };
}

function patchPayload(input) {
  if (input != null && typeof input === 'object' && !Array.isArray(input)) {
    return input;
  }
  return {};
}

function requireNonEmptyString(p, key, actionLabel) {
  const v = p[key];
  if (v == null || (typeof v === 'string' && v.trim() === '')) {
    throw AppError.badRequest(`${actionLabel}: ${key} is required`);
  }
}

async function updateProductMap(mapId, action, payload, { req } = {}) {
  const ctx = await mapDb.getMapContext(mapId);
  if (!ctx) throw AppError.notFound('Product map not found');
  const deployment = await deployments.findById(ctx.projectId);
  if (deployment && req) checkProjectAccess(deployment, req);

  const p = patchPayload(payload);

  switch (action) {
    case 'confirmPersona': {
      requireNonEmptyString(p, 'personaId', 'confirmPersona');
      await mapDb.updatePersona(p.personaId, { confirmed: true });
      break;
    }
    case 'addPersona': {
      requireNonEmptyString(p, 'name', 'addPersona');
      await mapDb.addPersona(mapId, p);
      break;
    }
    case 'removePersona': {
      requireNonEmptyString(p, 'personaId', 'removePersona');
      await mapDb.removePersona(p.personaId);
      break;
    }
    case 'confirmJob': {
      requireNonEmptyString(p, 'jobId', 'confirmJob');
      await mapDb.updateJob(p.jobId, { confirmed: true });
      break;
    }
    case 'addJob': {
      requireNonEmptyString(p, 'personaId', 'addJob');
      requireNonEmptyString(p, 'title', 'addJob');
      await mapDb.addJob(mapId, p);
      break;
    }
    case 'removeJob': {
      requireNonEmptyString(p, 'jobId', 'removeJob');
      await mapDb.removeJob(p.jobId);
      break;
    }
    case 'setPriority': {
      requireNonEmptyString(p, 'jobId', 'setPriority');
      const pr = p.priority || 'medium';
      await mapDb.updateJob(p.jobId, {
        priority: pr,
        weight: weightFromPriority(pr),
      });
      break;
    }
    case 'addEdge': {
      requireNonEmptyString(p, 'fromId', 'addEdge');
      requireNonEmptyString(p, 'toId', 'addEdge');
      requireNonEmptyString(p, 'type', 'addEdge');
      await mapDb.addEdge(mapId, p);
      break;
    }
    case 'removeEdge': {
      requireNonEmptyString(p, 'edgeId', 'removeEdge');
      await mapDb.removeEdge(p.edgeId);
      break;
    }
    case 'confirmEdge': {
      requireNonEmptyString(p, 'edgeId', 'confirmEdge');
      await mapDb.confirmEdge(p.edgeId);
      break;
    }
    default:
      throw AppError.badRequest(`Unknown action: ${action}`);
  }

  return recomputeAndPersist(mapId);
}

async function getScores(mapId) {
  const r = await recomputeAndPersist(mapId);
  if (!r) return null;
  return {
    appScore: r.scores.app,
    personaScores: r.scores.persona,
    jobScores: r.scores.job,
    moduleRanking: r.scores.moduleRanking,
    raw: r.scores,
  };
}

async function simulateForModule(mapId, moduleId) {
  const full = await mapDb.getProductMap(mapId);
  if (!full) return null;
  const g = graphFromDbRow(full);
  const { simulateModule } = require('./job-scorer');
  return simulateModule(moduleId, g.jobs, g.entities, g.edges);
}

module.exports = {
  createProductMap,
  updateProductMap,
  recomputeAndPersist,
  getScores,
  simulateForModule,
  graphFromDbRow,
  getMapByProject: (projectId) => mapDb.getMapByProject(projectId),
  getProductMap: (mapId) => mapDb.getProductMap(mapId),
  loadCodebaseModel,
};

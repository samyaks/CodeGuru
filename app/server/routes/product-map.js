const express = require('express');
const { deployments, productMap: productMapStore } = require('../lib/db');
const { asyncHandler } = require('../lib/async-handler');
const { checkProjectAccess } = require('../lib/helpers');
const { AppError } = require('../lib/app-error');
const {
  createProductMap,
  updateProductMap,
  getScores,
  simulateForModule,
  getMapByProject,
} = require('../services/product-map');

const router = express.Router();

function mapRowToApi(map) {
  if (!map) return null;
  return {
    id: map.id,
    projectId: map.project_id,
    analysisId: map.analysis_id,
    description: map.description,
    domain: map.domain,
    scores: map.scores,
    createdAt: map.created_at,
  };
}

function formatFullMap(full) {
  if (!full) return null;
  const { map, personas, jobs, entities, edges } = full;
  return {
    map: mapRowToApi(map),
    personas: (personas || []).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      emoji: p.emoji,
      confirmed: p.confirmed,
      sortOrder: p.sort_order,
    })),
    jobs: (jobs || []).map((j) => ({
      id: j.id,
      mapId: j.map_id,
      personaId: j.persona_id,
      title: j.title,
      priority: j.priority,
      weight: j.weight,
      confirmed: j.confirmed,
      sortOrder: j.sort_order,
    })),
    entities: (entities || []).map((e) => ({
      id: e.id,
      mapId: e.map_id,
      type: e.type,
      key: e.key,
      label: e.label,
      filePath: e.file_path,
      status: e.status,
      module: e.module,
      metadata: e.metadata,
    })),
    edges: (edges || []).map((e) => ({
      id: e.id,
      mapId: e.map_id,
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

router.post(
  '/:projectId',
  asyncHandler(async (req, res) => {
    try {
      const { projectId } = req.params;
      const { analysisId, description } = req.body || {};
      if (!analysisId) {
        return res.status(400).json({ error: 'analysisId is required in body', code: 'BAD_REQUEST' });
      }
      const result = await createProductMap(projectId, analysisId, description, { req });
      res.status(201).json({
        ...result,
        map: {
          id: result.mapId,
          projectId: result.projectId,
          analysisId: result.analysisId,
          description: result.description,
          domain: result.domain,
          scores: result.scores,
        },
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code || 'ERROR' });
      }
      console.error('[product-map] POST', err);
      return res.status(500).json({ error: err.message || 'Failed to create product map', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/:mapId/scores',
  asyncHandler(async (req, res) => {
    try {
      const { mapId } = req.params;
      const deployment = await getDeploymentForMap(mapId, req);
      if (deployment) checkProjectAccess(deployment, req);
      const out = await getScores(mapId);
      if (!out) return res.status(404).json({ error: 'Product map not found', code: 'NOT_FOUND' });
      res.json({
        appScore: out.appScore,
        personaScores: out.personaScores,
        jobScores: out.jobScores,
        moduleRanking: out.moduleRanking,
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code || 'ERROR' });
      }
      console.error('[product-map] GET scores', err);
      return res.status(500).json({ error: err.message || 'Failed to load scores', code: 'INTERNAL_ERROR' });
    }
  })
);

router.get(
  '/:mapId/simulate/:moduleId',
  asyncHandler(async (req, res) => {
    try {
      const { mapId, moduleId } = req.params;
      const deployment = await getDeploymentForMap(mapId, req);
      if (deployment) checkProjectAccess(deployment, req);
      const out = await simulateForModule(mapId, decodeURIComponent(moduleId));
      if (!out) return res.status(404).json({ error: 'Product map not found', code: 'NOT_FOUND' });
      res.json(out);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code || 'ERROR' });
      }
      console.error('[product-map] GET simulate', err);
      return res.status(500).json({ error: err.message || 'Simulation failed', code: 'INTERNAL_ERROR' });
    }
  })
);

router.patch(
  '/:mapId',
  asyncHandler(async (req, res) => {
    try {
      const { mapId } = req.params;
      const { action, payload = {} } = req.body || {};
      if (!action) {
        return res.status(400).json({ error: 'action is required', code: 'BAD_REQUEST' });
      }
      const updated = await updateProductMap(mapId, action, payload, { req });
      if (!updated) return res.status(404).json({ error: 'Product map not found', code: 'NOT_FOUND' });
      res.json({
        map: mapRowToApi(updated.map),
        scores: updated.scores,
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code || 'ERROR' });
      }
      console.error('[product-map] PATCH', err);
      return res.status(500).json({ error: err.message || 'Update failed', code: 'INTERNAL_ERROR' });
    }
  })
);

async function getDeploymentForMap(mapId) {
  const ctx = await productMapStore.getMapContext(mapId);
  if (!ctx) return null;
  return deployments.findById(ctx.projectId);
}

router.get(
  '/:projectId',
  asyncHandler(async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await deployments.findById(projectId);
      if (!project) return res.status(404).json({ error: 'Project not found', code: 'NOT_FOUND' });
      checkProjectAccess(project, req);
      const full = await getMapByProject(projectId);
      if (!full) {
        return res.json({ map: null, message: 'No product map for this project yet' });
      }
      res.json(formatFullMap(full));
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ error: err.message, code: err.code || 'ERROR' });
      }
      console.error('[product-map] GET', err);
      return res.status(500).json({ error: err.message || 'Failed to load product map', code: 'INTERNAL_ERROR' });
    }
  })
);

module.exports = router;

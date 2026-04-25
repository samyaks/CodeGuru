const { CLAUDE_MODEL, anthropic } = require('../lib/constants');
const { createMessageTracked } = require('../lib/anthropic-tracked');
const { stripJsonFence } = require('./map-extractor');

const LINK_PROMPT = `You are mapping product jobs to code entities.

Given a job description and a list of code entities (pages, routes,
components, capabilities), determine which entities this job NEEDS
to function. Only include entities that are truly required — not
tangentially related.

Respond with JSON array only:
[
  { "entityId": "...", "reason": "short explanation", "confidence": 0.0 }
]

Only include matches with confidence >= 0.5.`;

function heuristicLink(jobs, entities) {
  const edges = [];

  for (const job of jobs) {
    const title = (job.title || '').toLowerCase();

    const keywordMap = {
      'sign up|log in|login|register|auth|account': 'cap:auth',
      'pay|invoice|billing|checkout|subscription': 'cap:payments',
      'upload|file|image|photo|attachment': 'cap:storage',
      'email|notify|notification|alert': 'cap:email',
      'deploy|publish|go live|launch|ship': 'cap:deployment',
      'save|store|persist|database|data': 'cap:database',
    };

    for (const [pattern, entityId] of Object.entries(keywordMap)) {
      if (new RegExp(pattern, 'i').test(title)) {
        const entity = entities.find((e) => e.id === entityId);
        if (entity) {
          edges.push({
            fromId: job.id,
            toId: entityId,
            type: 'needs',
            label: `Job references ${(entity.label || entity.key || '').toLowerCase()}`,
            confidence: 0.7,
            method: 'heuristic',
          });
        }
      }
    }

    for (const entity of entities.filter((e) => e.type === 'page')) {
      const pageName = (entity.key || '').replace(/[/:_-]/g, ' ').toLowerCase();
      const words = title.split(/\s+/);
      const overlap = words.filter((w) => w.length > 3 && pageName.includes(w));
      if (overlap.length > 0) {
        edges.push({
          fromId: job.id,
          toId: entity.id,
          type: 'needs',
          label: `Job mentions "${overlap.join(', ')}" — page matches`,
          confidence: Math.min(0.95, 0.5 + overlap.length * 0.1),
          method: 'heuristic',
        });
      }
    }
  }

  return edges;
}

async function claudeLink(job, entities, codebaseModel, analysisId) {
  const entityList = entities
    .map((e) => `${e.id}: ${e.label || e.key} (${e.type}, status: ${e.status})`)
    .join('\n');

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: analysisId || 'map-link',
    phase: 'link-job',
    params: {
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      system: LINK_PROMPT,
      messages: [{
        role: 'user',
        content: `Job: "${job.title}" (${job.priority || 'medium'} priority)\n\nEntities:\n${entityList}`,
      }],
    },
  });

  const raw = response.content?.[0]?.text || '[]';
  const links = JSON.parse(stripJsonFence(raw));
  if (!Array.isArray(links)) return [];
  return links
    .filter((l) => l && l.confidence >= 0.5 && l.entityId)
    .map((l) => ({
      fromId: job.id,
      toId: l.entityId,
      type: 'needs',
      label: l.reason || 'AI link',
      confidence: Math.min(1, Number(l.confidence) || 0.5),
      method: 'ai',
    }));
}

function linkCodeEntities(entities, fileContents) {
  const fc = fileContents || {};
  const edges = [];

  for (const page of entities.filter((e) => e.type === 'page')) {
    const content = fc[page.filePath] || '';
    for (const comp of entities.filter((e) => e.type === 'component')) {
      if (comp.key && content.includes(comp.key)) {
        edges.push({
          fromId: page.id,
          toId: comp.id,
          type: 'renders',
          label: `${page.label || page.key} imports ${comp.key}`,
          confidence: 0.9,
          method: 'heuristic',
        });
      }
    }
  }

  for (const comp of entities.filter((e) => e.type === 'component')) {
    const content = fc[comp.filePath] || '';
    for (const route of entities.filter((e) => e.type === 'route')) {
      const routePath = (route.key || '').split(' ').pop();
      if (routePath && content.includes(routePath)) {
        edges.push({
          fromId: comp.id,
          toId: route.id,
          type: 'calls',
          label: `${comp.key} calls ${route.key}`,
          confidence: 0.85,
          method: 'heuristic',
        });
      }
    }
  }

  for (const route of entities.filter((e) => e.type === 'route')) {
    const content = fc[route.filePath] || '';
    if (/supabase|auth|session|jwt|bcrypt|passport/i.test(content)) {
      edges.push({
        fromId: route.id,
        toId: 'cap:auth',
        type: 'requires',
        label: 'Uses auth',
        confidence: 0.8,
        method: 'heuristic',
      });
    }
    if (/prisma|drizzle|knex|sequelize|query|SELECT|INSERT/i.test(content)) {
      edges.push({
        fromId: route.id,
        toId: 'cap:database',
        type: 'requires',
        label: 'Reads/writes DB',
        confidence: 0.8,
        method: 'heuristic',
      });
    }
    if (/stripe|payment|charge|checkout/i.test(content)) {
      edges.push({
        fromId: route.id,
        toId: 'cap:payments',
        type: 'requires',
        label: 'Processes payments',
        confidence: 0.8,
        method: 'heuristic',
      });
    }
  }

  return edges;
}

function mergeEdges(edgeLists) {
  const map = new Map();
  for (const list of edgeLists) {
    for (const e of list) {
      const key = `${e.fromId}|${e.toId}|${e.type}`;
      const prev = map.get(key);
      if (!prev || (e.confidence || 0) > (prev.confidence || 0)) {
        map.set(key, e);
      }
    }
  }
  return [...map.values()];
}

/**
 * @returns {Promise<Array<{ fromId, toId, type, label, confidence, method }>>}
 */
async function linkAll(jobs, entities, codebaseModel, analysisId) {
  const h = heuristicLink(jobs, entities);
  const fileContents = (codebaseModel && codebaseModel.fileContents) || {};
  const code = linkCodeEntities(entities, fileContents);

  const byJobNeeds = new Map();
  for (const e of h) {
    if (e.type !== 'needs') continue;
    byJobNeeds.set(e.fromId, (byJobNeeds.get(e.fromId) || 0) + 1);
  }

  const aiEdges = [];
  for (const job of jobs) {
    if ((byJobNeeds.get(job.id) || 0) >= 2) continue;
    try {
      const more = await claudeLink(job, entities, codebaseModel, analysisId);
      aiEdges.push(...more);
    } catch (err) {
      console.warn(`[map-linker] claudeLink failed for job ${job.id}:`, err.message);
    }
  }

  return mergeEdges([h, code, aiEdges]);
}

module.exports = {
  heuristicLink,
  claudeLink,
  linkCodeEntities,
  linkAll,
};

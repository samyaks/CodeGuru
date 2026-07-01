/**
 * Intent feature synthesis — pipeline stage 1b (runs right after bootstrap,
 * replacing the plain grouping stage).
 *
 * Turns the granular intent statements into a small set of product FEATURES,
 * each tied to a persona and a job-to-be-done, so the Context tab reads like a
 * plan (Persona -> Job -> Feature -> statement) instead of a flat list of
 * component-named buckets. It:
 *   1. Derives a feature catalog with one bounded LLM call — each feature has a
 *      title, one-line summary, persona (name + emoji), job-to-be-done, and
 *      priority. When the project has a product map, personas/jobs are reused
 *      from it (capturing map_jobs.id); otherwise a lightweight set is derived
 *      from the statement texts + app description.
 *   2. Assigns every statement to a feature in bounded batches, persisting
 *      `group_label = feature.title` (the join key the mapper groups by).
 *   3. Persists the feature catalog via intentFeatures.replaceForProject.
 *
 * Non-fatal by contract: the pipeline calls this in a try/catch. Features are a
 * derived view (regenerated every analysis); the human source of truth stays at
 * the statement level.
 */

const { CLAUDE_MODEL, HAIKU_MODEL, anthropic } = require('../../lib/constants');
const { createMessageTracked, extractText } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');
const { intentStatements, intentFeatures, productMap } = require('../../lib/db');
const { chunk, vocabularyIndex, parseAssignments } = require('./grouping');

const MIN_STATEMENTS_TO_SYNTHESIZE = 6;
const TARGET_MIN_FEATURES = 5;
const TARGET_MAX_FEATURES = 12;
const ASSIGN_BATCH = 60;
const CATALOG_SAMPLE = 160;
const MAX_TEXT = 240;

// ── pure helpers (unit-tested) ────────────────────────────────────────────

function shortText(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

function cleanStr(v, cap = 200) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return s.length > cap ? s.slice(0, cap).trim() : s;
}

function normalizePriority(p) {
  const s = String(p == null ? '' : p).toLowerCase().trim();
  return ['high', 'medium', 'low'].includes(s) ? s : 'medium';
}

/**
 * Parse a feature-catalog LLM response into validated feature objects.
 * Accepts a JSON array (or an object with a `features` array). Dedupes by title
 * (case-insensitive), caps the count, and — when `validJobIds` is provided —
 * keeps `jobId` only if it references a real product-map job.
 *
 * @returns {Array<{title,summary,personaName,personaEmoji,jobTitle,priority,jobId}>}
 */
function parseFeatureCatalog(rawText, validJobIds = null, cap = TARGET_MAX_FEATURES) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(String(rawText || '')));
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.features) ? parsed.features : []);

  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const title = cleanStr(raw.title, 60);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;

    let jobId = null;
    if (raw.jobId != null && (!validJobIds || validJobIds.has(String(raw.jobId)))) {
      jobId = String(raw.jobId);
    }

    seen.add(key);
    out.push({
      title,
      summary: cleanStr(raw.summary, 240) || null,
      personaName: cleanStr(raw.persona, 60) || null,
      personaEmoji: cleanStr(raw.personaEmoji, 8) || null,
      jobTitle: cleanStr(raw.job, 120) || null,
      priority: normalizePriority(raw.priority),
      jobId,
    });
    if (out.length >= cap) break;
  }
  return out;
}

// Product-map personas/jobs (snake_case rows) -> compact prompt vocabulary.
function buildJobVocabulary(map) {
  if (!map || !Array.isArray(map.jobs) || map.jobs.length === 0) return null;
  const personasById = new Map((map.personas || []).map((p) => [p.id, p]));
  const jobs = map.jobs.map((j) => {
    const persona = personasById.get(j.persona_id);
    return {
      id: j.id,
      title: j.title,
      priority: j.priority || 'medium',
      personaName: persona?.name || null,
      personaEmoji: persona?.emoji || null,
    };
  });
  return { jobs, validJobIds: new Set(jobs.map((j) => String(j.id))) };
}

// ── LLM steps ───────────────────────────────────────────────────────────────

const CATALOG_SYSTEM = `You organize a software product's intent statements into a SMALL set of FEATURES, each framed around the user and the job they are trying to get done — the kind of sections a product plan or PRD would have.

For each feature provide:
- "title": concise Title Case product feature name (1-4 words). NEVER a file or component name (no "UserMenu", "index", "ErrorBoundary").
- "summary": one plain sentence describing what the feature does for the user.
- "persona": the user type it serves (e.g. "Shop owner").
- "personaEmoji": a single emoji matching the persona.
- "job": the job-to-be-done it enables, phrased as an action the user wants (e.g. "Send a customer a price quote over WhatsApp").
- "priority": "high" (core value prop), "medium", or "low".

Rules:
- Produce ${TARGET_MIN_FEATURES}-${TARGET_MAX_FEATURES} features that together cover ALL the statements. Fewer, broader features are better than many narrow ones.
- Respond with ONLY a JSON array of feature objects. No prose, no fences.`;

const CATALOG_SYSTEM_WITH_MAP = `${CATALOG_SYSTEM}

This project already has a product map with confirmed personas and jobs-to-be-done. PREFER reusing them: when a feature maps to one of the provided jobs, copy its "job" title and "persona" verbatim and set "jobId" to that job's id. Only invent a new persona/job (with no jobId) when no provided job fits.`;

async function deriveFeatureCatalog(projectId, statements, { appDescription, jobVocab }) {
  const sample = statements.slice(0, CATALOG_SAMPLE)
    .map((s) => `- (${s.kind}) ${shortText(s.text)}`).join('\n');

  const parts = [];
  if (appDescription) parts.push(`App description: ${cleanStr(appDescription, 400)}`, '');
  parts.push('Intent statements:', sample);
  if (jobVocab) {
    const jobLines = jobVocab.jobs.map((j) => {
      const persona = j.personaName ? ` [persona: ${j.personaEmoji || ''} ${j.personaName}]`.trimEnd() : '';
      return `- ${j.id}: "${j.title}" (${j.priority})${persona}`;
    }).join('\n');
    parts.push('', 'Existing product-map jobs (reuse when they fit; copy title/persona and set jobId):', jobLines);
  }

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: projectId,
    phase: 'intent.features',
    params: {
      // Headroom for a possible leading `thinking` block plus the JSON output.
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      system: [{
        type: 'text',
        text: jobVocab ? CATALOG_SYSTEM_WITH_MAP : CATALOG_SYSTEM,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: parts.join('\n') }],
    },
  });
  return parseFeatureCatalog(extractText(response), jobVocab ? jobVocab.validJobIds : null);
}

const ASSIGN_SYSTEM = `You assign each intent statement to exactly ONE feature from a fixed list.

Rules:
- Use ONLY the provided feature names, copied verbatim. Never invent a new feature.
- Every statement gets exactly one feature — pick the best fit.
- Respond with ONLY a JSON object mapping each statement's number to its feature name, e.g. {"1":"Pricing Import","2":"WhatsApp Assistant"}. No prose, no fences.`;

async function assignBatch(projectId, batch, featureTitles) {
  const featureList = featureTitles.map((t) => `- ${t}`).join('\n');
  const items = batch.map((s, i) => `${i + 1}. (${s.kind}) ${shortText(s.text)}`).join('\n');
  const userContent = [
    'Features (choose exactly one per statement, verbatim):',
    featureList,
    '',
    'Statements:',
    items,
  ].join('\n');

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: projectId,
    phase: 'intent.features',
    params: {
      model: HAIKU_MODEL || CLAUDE_MODEL,
      max_tokens: 3000,
      system: [{ type: 'text', text: ASSIGN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    },
  });
  return parseAssignments(extractText(response), batch, vocabularyIndex(featureTitles));
}

// ── orchestrator ──────────────────────────────────────────────────────────

/**
 * Synthesize features (with persona + job-to-be-done) for a project and persist
 * both the feature catalog and each statement's group_label. Operates on
 * non-rejected statements (candidate + confirmed).
 *
 * @param {string} projectId - deployments.id
 * @param {object} codebaseModel - optional; `meta.description` seeds the catalog.
 * @returns {Promise<{ synthesized: boolean, features?: number, assigned?: number, total?: number, usedMap?: boolean, reason?: string }>}
 */
async function runFeatureSynthesis(projectId, codebaseModel) {
  const rows = await intentStatements.findByProjectId(projectId);
  const statements = (rows || [])
    .filter((r) => r && r.status !== 'rejected')
    .map((r) => ({ id: r.id, text: r.text, kind: r.kind }));

  if (statements.length < MIN_STATEMENTS_TO_SYNTHESIZE) {
    return { synthesized: false, reason: 'too_few', total: statements.length };
  }

  // Reuse the product map's personas/jobs when one exists (best-effort).
  let jobVocab = null;
  try {
    const map = await productMap.getMapByProject(projectId);
    jobVocab = buildJobVocabulary(map);
  } catch (err) {
    console.error(`[intent.features] product map lookup failed for ${projectId}: ${err.message}`);
  }

  const appDescription = codebaseModel && codebaseModel.meta ? codebaseModel.meta.description : null;

  let catalog = [];
  try {
    catalog = await deriveFeatureCatalog(projectId, statements, { appDescription, jobVocab });
  } catch (err) {
    console.error(`[intent.features] catalog derivation failed for ${projectId}: ${err.message}`);
  }
  if (catalog.length < 2) {
    return { synthesized: false, reason: 'no_catalog', total: statements.length };
  }

  const titles = catalog.map((f) => f.title);

  const assignments = [];
  for (const batch of chunk(statements, ASSIGN_BATCH)) {
    try {
      assignments.push(...await assignBatch(projectId, batch, titles));
    } catch (err) {
      console.error(`[intent.features] batch assignment failed for ${projectId}: ${err.message}`);
    }
  }
  if (assignments.length === 0) {
    return { synthesized: false, reason: 'no_assignments', total: statements.length };
  }

  // Keep only features that actually collected statements, preserving catalog
  // order for a stable sort_order.
  const usedTitles = new Set(assignments.map((a) => a.groupLabel));
  const keptFeatures = catalog
    .filter((f) => usedTitles.has(f.title))
    .map((f) => ({
      label: f.title,
      summary: f.summary,
      personaName: f.personaName,
      personaEmoji: f.personaEmoji,
      jobTitle: f.jobTitle,
      priority: f.priority,
      jobId: f.jobId,
    }));

  let assigned = 0;
  let featureCount = 0;
  try {
    assigned = await intentStatements.setGroupLabels(projectId, assignments);
    featureCount = await intentFeatures.replaceForProject(projectId, keptFeatures);
  } catch (err) {
    console.error(`[intent.features] persist failed for ${projectId}: ${err.message}`);
    return { synthesized: false, reason: 'persist_failed', total: statements.length };
  }

  return {
    synthesized: true,
    features: featureCount,
    assigned,
    total: statements.length,
    usedMap: Boolean(jobVocab),
  };
}

module.exports = {
  runFeatureSynthesis,
  // exported for tests
  parseFeatureCatalog,
  buildJobVocabulary,
  normalizePriority,
  shortText,
  cleanStr,
};

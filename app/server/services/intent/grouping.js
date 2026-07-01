/**
 * Intent grouping — pipeline stage 1b (runs right after bootstrap).
 *
 * Why this exists: `feature_area` is derived deterministically from file paths
 * by the structure extractor. In deeply-nested repos every layout segment is
 * generic, so it falls back to the *filename* — turning individual components
 * into their own "area" (usermenu, readinessring, errorboundary, ...). The
 * Context tab then shows dozens of one-file groups instead of a handful of
 * product areas.
 *
 * This stage runs a small, bounded LLM pass over a project's statements and
 * assigns each a coarse, product-level `group_label` (e.g. "Authentication",
 * "Repo analysis", "Gap tracking"). It:
 *   1. Builds a vocabulary of 5-10 area names — seeded from the analysis's
 *      detected features when present, refined/derived by one LLM call.
 *   2. Assigns every statement to exactly one vocabulary area (batched).
 *   3. Persists `group_label`. `feature_area` is left untouched — bootstrap
 *      idempotency and reconciliation still key on it; grouping is presentation
 *      only (the mapper groups by group_label and falls back to feature_area).
 *
 * Non-fatal by contract: the pipeline calls this in a try/catch, so any failure
 * just leaves statements grouped by their existing feature_area.
 */

const { CLAUDE_MODEL, HAIKU_MODEL, anthropic } = require('../../lib/constants');
const { createMessageTracked, extractText } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');
const { intentStatements } = require('../../lib/db');

// Don't bother grouping tiny projects — a few statements read fine ungrouped
// and it isn't worth an LLM call.
const MIN_STATEMENTS_TO_GROUP = 6;
const TARGET_MIN_AREAS = 4;
const TARGET_MAX_AREAS = 10;
// Keep each assignment call bounded regardless of project size.
const ASSIGN_BATCH = 60;
// Cap statement text fed to the model so a pathological statement can't blow
// the prompt budget.
const MAX_TEXT = 240;

// ── pure helpers (unit-tested) ────────────────────────────────────────────

// Normalize a human-facing area name: trim, collapse whitespace, cap length.
function normalizeAreaName(name) {
  const s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > 60 ? s.slice(0, 60).trim() : s;
}

// Dedupe area names case-insensitively, preserving first-seen casing, capped.
function dedupeAreas(names, cap = TARGET_MAX_AREAS) {
  const seen = new Map(); // lower -> canonical
  for (const raw of Array.isArray(names) ? names : []) {
    const canon = normalizeAreaName(raw);
    if (!canon) continue;
    const key = canon.toLowerCase();
    if (!seen.has(key)) seen.set(key, canon);
    if (seen.size >= cap) break;
  }
  return [...seen.values()];
}

// Seed area names from the analysis's detected features. These are hints only —
// the LLM pass refines them into product-level names. Returns [] when absent.
function collectSeedNames(codebaseModel) {
  const features = codebaseModel && Array.isArray(codebaseModel.features)
    ? codebaseModel.features
    : [];
  const names = features
    .map((f) => (f && typeof f.name === 'string' ? f.name : ''))
    .filter(Boolean);
  return dedupeAreas(names);
}

// Parse a vocabulary LLM response — a JSON array of strings (tolerates an
// object with an `areas` array). Returns a deduped, capped string[].
function parseVocabulary(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(String(rawText || '')));
  } catch {
    return [];
  }
  const arr = Array.isArray(parsed)
    ? parsed
    : (parsed && Array.isArray(parsed.areas) ? parsed.areas : []);
  return dedupeAreas(arr);
}

// Build a lowercase -> canonical lookup for a vocabulary.
function vocabularyIndex(vocabulary) {
  const idx = new Map();
  for (const name of vocabulary) idx.set(name.toLowerCase(), name);
  return idx;
}

/**
 * Parse an assignment LLM response for one batch.
 * @param {string} rawText  model output: a JSON object mapping the batch's
 *   1-based index (as string or number) to an area name.
 * @param {Array<{id:string}>} batch  the statements sent, in order (index 1..N).
 * @param {Map<string,string>} vocabIndex  lowercase -> canonical area.
 * @returns {Array<{id:string, groupLabel:string}>}  only confidently-matched rows.
 */
function parseAssignments(rawText, batch, vocabIndex) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(String(rawText || '')));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];

  const out = [];
  for (const [key, rawArea] of Object.entries(parsed)) {
    const n = Number(key);
    if (!Number.isInteger(n) || n < 1 || n > batch.length) continue;
    const stmt = batch[n - 1];
    if (!stmt || typeof stmt.id !== 'string') continue;
    const canon = vocabIndex.get(normalizeAreaName(rawArea).toLowerCase());
    if (!canon) continue; // area outside the fixed vocabulary — drop, keep fallback
    out.push({ id: stmt.id, groupLabel: canon });
  }
  return out;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function shortText(text) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;
}

// ── LLM steps ───────────────────────────────────────────────────────────────

const VOCAB_SYSTEM = `You organize a software product's intent statements into a SMALL set of coarse, product-level feature areas — the kind of sections a product spec would have (e.g. "Authentication", "Repo analysis", "Gap tracking", "Deployment").

Rules:
- Produce ${TARGET_MIN_AREAS}-${TARGET_MAX_AREAS} areas that together cover ALL the statements. Fewer, broader areas are better than many narrow ones.
- Areas are PRODUCT capabilities, never file or component names (no "UserMenu", "index", "ErrorBoundary").
- Use concise Title Case names (1-3 words).
- Respond with ONLY a JSON array of strings. No prose, no fences.`;

const ASSIGN_SYSTEM = `You assign each intent statement to exactly ONE feature area from a fixed list.

Rules:
- Use ONLY the provided area names, copied verbatim. Never invent a new area.
- Every statement gets exactly one area — pick the best fit.
- Respond with ONLY a JSON object mapping each statement's number to its area name, e.g. {"1":"Authentication","2":"Repo analysis"}. No prose, no fences.`;

async function deriveVocabulary(projectId, statements, seeds) {
  const sample = statements.slice(0, 160).map((s) => `- (${s.kind}) ${shortText(s.text)}`).join('\n');
  const seedBlock = seeds.length
    ? `\n\nExisting rough areas detected in the codebase (use as hints, rename/merge freely):\n${seeds.map((s) => `- ${s}`).join('\n')}`
    : '';
  const userContent = `Intent statements:\n${sample}${seedBlock}`;

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: projectId,
    phase: 'intent.grouping',
    params: {
      // Headroom for a possible leading `thinking` block plus the JSON output.
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: VOCAB_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    },
  });
  return parseVocabulary(extractText(response));
}

async function assignBatch(projectId, batch, vocabulary) {
  const areaList = vocabulary.map((a) => `- ${a}`).join('\n');
  const items = batch
    .map((s, i) => `${i + 1}. (${s.kind}) ${shortText(s.text)}`)
    .join('\n');
  const userContent = [
    'Feature areas (choose exactly one per statement, verbatim):',
    areaList,
    '',
    'Statements:',
    items,
  ].join('\n');

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: projectId,
    phase: 'intent.grouping',
    params: {
      model: HAIKU_MODEL || CLAUDE_MODEL,
      max_tokens: 3000,
      system: [{ type: 'text', text: ASSIGN_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    },
  });
  return parseAssignments(extractText(response), batch, vocabularyIndex(vocabulary));
}

// ── orchestrator ──────────────────────────────────────────────────────────

/**
 * Group a project's intent statements into coarse product areas and persist
 * `group_label`. Operates on non-rejected statements (candidate + confirmed).
 *
 * @param {string} projectId - deployments.id
 * @param {object} codebaseModel - carries detected `features` used as seed hints.
 * @returns {Promise<{ grouped: boolean, areas?: number, assigned?: number, total?: number, reason?: string }>}
 */
async function runGrouping(projectId, codebaseModel) {
  const rows = await intentStatements.findByProjectId(projectId);
  const statements = (rows || [])
    .filter((r) => r && r.status !== 'rejected')
    .map((r) => ({ id: r.id, text: r.text, kind: r.kind }));

  if (statements.length < MIN_STATEMENTS_TO_GROUP) {
    return { grouped: false, reason: 'too_few', total: statements.length };
  }

  const seeds = collectSeedNames(codebaseModel);

  let vocabulary = [];
  try {
    vocabulary = await deriveVocabulary(projectId, statements, seeds);
  } catch (err) {
    console.error(`[intent.grouping] vocabulary derivation failed for ${projectId}: ${err.message}`);
  }
  // Fall back to the detected-feature seeds if the model gave us nothing usable.
  if (vocabulary.length < 2) vocabulary = dedupeAreas([...vocabulary, ...seeds]);
  if (vocabulary.length < 2) {
    return { grouped: false, reason: 'no_vocabulary', total: statements.length };
  }

  const assignments = [];
  for (const batch of chunk(statements, ASSIGN_BATCH)) {
    try {
      const part = await assignBatch(projectId, batch, vocabulary);
      assignments.push(...part);
    } catch (err) {
      console.error(`[intent.grouping] batch assignment failed for ${projectId}: ${err.message}`);
    }
  }

  if (assignments.length === 0) {
    return { grouped: false, reason: 'no_assignments', total: statements.length };
  }

  let assigned = 0;
  try {
    assigned = await intentStatements.setGroupLabels(projectId, assignments);
  } catch (err) {
    console.error(`[intent.grouping] persist failed for ${projectId}: ${err.message}`);
    return { grouped: false, reason: 'persist_failed', total: statements.length };
  }

  return {
    grouped: true,
    areas: vocabulary.length,
    assigned,
    total: statements.length,
  };
}

module.exports = {
  runGrouping,
  // exported for tests / diagnostics
  deriveVocabulary,
  assignBatch,
  normalizeAreaName,
  dedupeAreas,
  collectSeedNames,
  parseVocabulary,
  parseAssignments,
  vocabularyIndex,
  chunk,
};

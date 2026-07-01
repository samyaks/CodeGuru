/**
 * Intent bootstrap — pipeline stage 1.
 *
 * Turns the deterministic structure anchors (Phase 2, structure-extractor.js)
 * into candidate intent statements via bounded Claude calls: ONE call per
 * feature area, each grounded in that area's anchors + linked source. Results
 * are persisted as `candidate` intent statements.
 *
 * Boundaries: this module reads anchors/source that are already in memory
 * during the takeoff pipeline run (codebaseModel.fileContents) and writes only
 * through the intentStatements repository. It never touches takeoff.js, routes,
 * or the schema.
 */

const { CLAUDE_MODEL, anthropic, truncate } = require('../../lib/constants');
const { createMessageTracked, extractText } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');
const { intentStatements } = require('../../lib/db');

// Total source budget per area. Keeps each Claude call bounded regardless of
// how many/large the anchor files are.
const AREA_SOURCE_BUDGET = 12000;
// Per-file cap so one huge file can't consume the whole area budget.
const PER_FILE_SOURCE_CAP = 6000;

const VALID_KINDS = new Set(['behavior', 'constraint', 'non_goal']);

const SYSTEM_PROMPT = `You are a senior engineer reverse-engineering the INTENT behind a codebase.
You are given the structural anchors (routes, models, endpoints, exported
functions/classes, entrypoints) for a single feature area, plus the relevant
source. Infer the candidate intent statements the code appears to implement.

A statement maps to exactly ONE testable behavior or invariant that is tied to
an identifiable code surface (an anchor).
- Good:      "Checkout requires a successful payment authorization before an order is created"
- Too coarse:"Handles payments"  (not a single testable behavior)
- Too fine:  "Validates amount > 0 on line 40"  (implementation detail, not intent)

Rules:
- Each statement.kind is one of: "behavior" (something the system does),
  "constraint" (an invariant/rule it must uphold), "non_goal" (something it
  deliberately does NOT do).
- Every statement MUST cite at least one anchor via links. Only cite anchors
  from the provided set — never invent a file_path or symbol.
- Prefer 3-8 statements for the area. Skip trivial CRUD plumbing.

Respond with ONLY a JSON array (no prose, no markdown fences) shaped exactly:
[
  {
    "text": "one-sentence testable behavior or invariant",
    "kind": "behavior" | "constraint" | "non_goal",
    "links": [{ "file_path": "...", "symbol": "..." }]
  }
]`;

// Group anchors by feature_area. Anchors with no area fall under 'core' so they
// still get proposed rather than silently dropped.
function groupByArea(anchors) {
  const byArea = new Map();
  for (const a of anchors) {
    const area = a && a.feature_area ? a.feature_area : 'core';
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(a);
  }
  return byArea;
}

// Normalize free text for a stable, punctuation/whitespace-insensitive compare.
function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?;:,]+$/g, '')
    .trim();
}

// Dedupe / suppression key.
//
// A candidate is considered "the same" as a prior REJECTED statement when it
// targets the same code surface with the same intent kind: we key on
//   feature_area :: kind :: <primary link file_path> :: <primary link symbol>
// using the FIRST link as the primary surface. We ALSO index rejected
// statements by normalized text, so a re-proposal that phrases the same intent
// against the same surface (structured key) OR repeats the exact wording
// (text key) is suppressed. Structured key is primary; text key is a backstop
// for statements whose links shifted but whose meaning did not.
function structuredKey(featureArea, kind, link) {
  const fp = link && link.file_path ? link.file_path : '';
  const sym = link && link.symbol ? link.symbol : '';
  return `${featureArea || ''}::${kind || ''}::${fp}::${sym}`;
}

function firstLink(links) {
  return Array.isArray(links) && links.length ? links[0] : null;
}

// Build the suppression sets from previously rejected statements.
function buildRejectedIndex(existing) {
  const structured = new Set();
  const texts = new Set();
  for (const row of existing) {
    if (!row || row.status !== 'rejected') continue;
    const links = Array.isArray(row.links) ? row.links : [];
    structured.add(structuredKey(row.feature_area, row.kind, firstLink(links)));
    const norm = normalizeText(row.text);
    if (norm) texts.add(norm);
  }
  return { structured, texts };
}

// Assemble the grounded source block for an area, honoring per-file and total
// budgets. Missing paths (not in fileContents) are skipped.
function buildSourceBlock(areaAnchors, fileContents) {
  const seenPaths = [];
  for (const a of areaAnchors) {
    if (a && a.file_path && !seenPaths.includes(a.file_path)) seenPaths.push(a.file_path);
  }

  const parts = [];
  let used = 0;
  for (const path of seenPaths) {
    if (used >= AREA_SOURCE_BUDGET) break;
    const content = fileContents && fileContents[path];
    if (typeof content !== 'string' || !content) continue;
    const remaining = AREA_SOURCE_BUDGET - used;
    const cap = Math.min(PER_FILE_SOURCE_CAP, remaining);
    const snippet = truncate(content, cap);
    parts.push(`--- ${path} ---\n${snippet}`);
    used += snippet.length;
  }
  return parts.join('\n\n');
}

// Valid anchor lookup for an area: `file_path|symbol` set. Used to drop any
// model-returned link that doesn't reference a real input anchor.
function buildAnchorKeySet(areaAnchors) {
  const set = new Set();
  for (const a of areaAnchors) {
    if (a && a.file_path && a.symbol) set.add(`${a.file_path}|${a.symbol}`);
  }
  return set;
}

// Validate/clean a single model-returned statement against the area's anchors.
// Returns a normalized statement object or null if it must be dropped.
function validateStatement(raw, anchorKeys) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  const kind = VALID_KINDS.has(raw.kind) ? raw.kind : null;
  if (!kind) return null;

  const links = Array.isArray(raw.links) ? raw.links : [];
  if (links.length === 0) return null; // must cite >= 1 anchor

  const cleanLinks = [];
  for (const l of links) {
    if (!l || typeof l !== 'object') return null;
    const file_path = typeof l.file_path === 'string' ? l.file_path.trim() : '';
    const symbol = typeof l.symbol === 'string' ? l.symbol.trim() : '';
    // Any link referencing something outside the input anchors invalidates the
    // whole statement — we only trust grounded citations.
    if (!file_path || !symbol || !anchorKeys.has(`${file_path}|${symbol}`)) return null;
    cleanLinks.push({ file_path, symbol });
  }

  return { text, kind, links: cleanLinks };
}

// One bounded Claude call for a single area. Returns the parsed raw statement
// array, or throws so the caller can record the area as failed.
async function generateForArea(projectId, featureArea, areaAnchors, fileContents) {
  const source = buildSourceBlock(areaAnchors, fileContents);
  const anchorList = areaAnchors.map((a) => ({
    file_path: a.file_path,
    symbol: a.symbol,
    kind: a.kind,
  }));

  const userContent = [
    `Feature area: ${featureArea}`,
    '',
    'Structural anchors (cite links only from this set):',
    JSON.stringify(anchorList, null, 2),
    '',
    'Relevant source (truncated):',
    source || '(no source available for these anchors)',
  ].join('\n');

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: projectId,
    phase: 'intent.bootstrap',
    params: {
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    },
  });

  const rawText = extractText(response);
  const parsed = JSON.parse(stripJsonFence(rawText));
  if (!Array.isArray(parsed)) {
    throw new Error('model response was not a JSON array');
  }
  return parsed;
}

/**
 * Bootstrap candidate intent statements for a project from its structure
 * anchors.
 *
 * @param {string} projectId - deployments.id
 * @param {object} codebaseModel - carries `structureAnchors` (Phase 2) and the
 *   in-memory `fileContents` { path: content } map.
 * @returns {Promise<{ areas: number, created: number, failedAreas: string[] }>}
 */
async function bootstrapIntent(projectId, codebaseModel) {
  const anchors = (codebaseModel && Array.isArray(codebaseModel.structureAnchors))
    ? codebaseModel.structureAnchors
    : [];
  if (anchors.length === 0) {
    return { areas: 0, created: 0, failedAreas: [] };
  }

  const fileContents = (codebaseModel && codebaseModel.fileContents) || {};
  const byArea = groupByArea(anchors);

  // Load existing statements once so we can suppress re-proposing anything a
  // human already rejected. Confirmed statements are left alone; only prior
  // candidates for a given area are replaced (see deleteCandidatesByArea).
  let rejectedIndex = { structured: new Set(), texts: new Set() };
  try {
    const existing = await intentStatements.findByProjectId(projectId);
    rejectedIndex = buildRejectedIndex(existing || []);
  } catch (err) {
    console.error(`[intent.bootstrap] could not load existing statements for ${projectId}: ${err.message}`);
  }

  let created = 0;
  const failedAreas = [];

  for (const [featureArea, areaAnchors] of byArea) {
    let statements;
    try {
      statements = await generateForArea(projectId, featureArea, areaAnchors, fileContents);
    } catch (err) {
      console.error(`[intent.bootstrap] area "${featureArea}" failed for ${projectId}: ${err.message}`);
      failedAreas.push(featureArea);
      continue;
    }

    const anchorKeys = buildAnchorKeySet(areaAnchors);
    const items = [];
    for (const raw of statements) {
      const stmt = validateStatement(raw, anchorKeys);
      if (!stmt) continue;

      // Suppress anything matching a previously rejected statement, by either
      // the structured surface key or the normalized text.
      const sKey = structuredKey(featureArea, stmt.kind, firstLink(stmt.links));
      if (rejectedIndex.structured.has(sKey)) continue;
      if (rejectedIndex.texts.has(normalizeText(stmt.text))) continue;

      items.push({
        project_id: projectId,
        text: stmt.text,
        kind: stmt.kind,
        status: 'candidate',
        source: 'inferred',
        feature_area: featureArea,
        links: stmt.links.map((l) => ({
          file_path: l.file_path,
          symbol: l.symbol,
          link_status: 'healthy',
        })),
      });
    }

    // Idempotency: replace only prior candidates for this area, then insert the
    // fresh set. Confirmed + rejected statements are untouched.
    try {
      await intentStatements.deleteCandidatesByArea(projectId, featureArea);
      if (items.length) {
        await intentStatements.createBatch(items);
        created += items.length;
      }
    } catch (err) {
      console.error(`[intent.bootstrap] persist for area "${featureArea}" failed for ${projectId}: ${err.message}`);
      failedAreas.push(featureArea);
    }
  }

  return { areas: byArea.size, created, failedAreas };
}

module.exports = { bootstrapIntent };

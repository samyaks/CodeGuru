// gap-job-linker.js
//
// Connects v2 Gaps (suggestions) to the product map's Jobs-to-be-done.
//
// Why we need this:
//   The v2 Gaps tab and the v2 Map tab are two views of "what's missing"
//   that started life completely decoupled — gaps came from
//   suggestion-rules.js + Claude analysis, jobs came from map-extractor.js
//   + the Map tab. The user asked the Gaps tab to surface "missing
//   features based on jobs to be done"; this service is the bridge.
//
// Strategy:
//   1. Heuristic pass first (cheap + deterministic):
//      - Suggestion `category` (auth/database/deployment/etc.) →
//        capability entity (`cap:auth`, `cap:database`, …) → jobs that
//        have a `needs` edge to that entity.
//      - `affected_files` overlap with entity `filePath` → jobs that
//        need that entity.
//   2. Claude pass for any remaining unlinked gaps (one batch call per
//      run, with per-batch chunking for large projects).
//   3. Persist results to `suggestions.v2_job_links` (migration 013).
//
// Idempotency:
//   `findUnlinkedV2GapsByProjectId` filters to rows where
//   `v2_job_links IS NULL`. Re-running is safe — already-linked rows are
//   left alone unless the caller passes `force: true`. To re-link after
//   the product map changes, call with `{ force: true, reset: true }`.

const { createMessageTracked } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');
const { suggestions } = require('../../lib/db');
const { productMap } = require('../../lib/db-map');

const CATEGORY_TO_CAPABILITY = {
  auth: 'cap:auth',
  authentication: 'cap:auth',
  permissions: 'cap:auth',
  security: 'cap:auth',
  database: 'cap:database',
  storage: 'cap:storage',
  email: 'cap:email',
  payments: 'cap:payments',
  payment: 'cap:payments',
  deployment: 'cap:deployment',
};

const HEURISTIC_CAPABILITY_CONFIDENCE = 0.85;
const HEURISTIC_FILE_CONFIDENCE = 0.75;
const MIN_CLAUDE_CONFIDENCE = 0.5;
const MAX_LINKS_PER_GAP = 3;
const CLAUDE_BATCH_SIZE = 25;

function getPersonaId(job) {
  return job.persona_id || job.personaId || null;
}

function entityFilePath(entity) {
  return entity?.filePath || entity?.file_path || null;
}

/**
 * Heuristic: link a single gap to jobs by matching the gap's category and
 * affected_files against the product-map graph. Returns up to
 * `MAX_LINKS_PER_GAP` links sorted by confidence desc.
 */
function heuristicLink(suggestionRow, jobs, entities, edges) {
  const cat = String(suggestionRow.category || '').toLowerCase();
  const seen = new Map(); // jobId → JobLink

  function addLink(jobId, personaId, confidence, reason) {
    if (!jobId) return;
    const existing = seen.get(jobId);
    if (existing && existing.confidence >= confidence) return;
    seen.set(jobId, {
      jobId,
      personaId,
      confidence,
      reason: String(reason).slice(0, 200),
      method: 'heuristic',
    });
  }

  // 1. Category → capability → jobs that need it.
  const capId = CATEGORY_TO_CAPABILITY[cat];
  if (capId) {
    const cap = entities.find((e) => e.id === capId);
    if (cap) {
      const capLabel = cap.label || cap.key || capId;
      for (const edge of edges) {
        if (edge.type !== 'needs' || edge.toId !== capId) continue;
        const job = jobs.find((j) => j.id === edge.fromId);
        if (!job) continue;
        addLink(
          job.id,
          getPersonaId(job),
          HEURISTIC_CAPABILITY_CONFIDENCE,
          `"${suggestionRow.title}" affects ${capLabel}, which "${job.title}" needs`,
        );
      }
    }
  }

  // 2. Affected files → entity → jobs that need it.
  const affected = Array.isArray(suggestionRow.affected_files)
    ? suggestionRow.affected_files
    : [];
  if (affected.length > 0) {
    const fileToEntity = new Map();
    for (const ent of entities) {
      const path = entityFilePath(ent);
      if (path) fileToEntity.set(path, ent);
    }
    for (const file of affected) {
      const ent = fileToEntity.get(file);
      if (!ent) continue;
      const entLabel = ent.label || ent.key || ent.id;
      for (const edge of edges) {
        if (edge.type !== 'needs' || edge.toId !== ent.id) continue;
        const job = jobs.find((j) => j.id === edge.fromId);
        if (!job) continue;
        addLink(
          job.id,
          getPersonaId(job),
          HEURISTIC_FILE_CONFIDENCE,
          `Touches ${file}, used by ${entLabel} which "${job.title}" needs`,
        );
      }
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_LINKS_PER_GAP);
}

const CLAUDE_SYSTEM = `You link software-engineering gaps to product jobs-to-be-done.

For each GAP, identify which JOBS it most directly enables or unblocks. A
"gap" is a missing or broken piece of code or infrastructure. A "job" is
something a user wants to do. A gap "affects" a job when shipping the gap
would unblock, complete, or materially improve the job for the user.

Rules:
- Pick at most 3 jobs per gap.
- Confidence is 0..1. Only include matches >= 0.5.
- Be conservative: prefer linking fewer jobs with higher confidence over
  many speculative links. If no jobs are affected, return no entries
  for that gap.

Respond with JSON only, no prose, no markdown fences:
{
  "links": [
    {
      "gapId": "<gap id>",
      "jobId": "<job id>",
      "confidence": 0.0-1.0,
      "reason": "one short sentence"
    }
  ]
}`;

async function claudeLinkBatch(gaps, jobs, personasById, projectId) {
  const result = new Map(); // gapId → JobLink[]

  const jobList = jobs.map((j) => {
    const persona = personasById.get(getPersonaId(j));
    const personaTag = persona ? `${persona.emoji || ''} ${persona.name || ''}`.trim() : 'unknown';
    return `- ${j.id}: "${j.title}" (for ${personaTag})`;
  }).join('\n');

  // Process in chunks so we don't blow the context window on huge projects.
  for (let i = 0; i < gaps.length; i += CLAUDE_BATCH_SIZE) {
    const batch = gaps.slice(i, i + CLAUDE_BATCH_SIZE);
    const gapList = batch.map((g) => {
      const desc = String(g.description || '').replace(/\s+/g, ' ').slice(0, 240);
      return `[${g.id}] ${g.category}: ${g.title}\n  ${desc}`;
    }).join('\n\n');

    let response;
    try {
      response = await createMessageTracked({
        phase: 'v2.gap.link',
        targetPath: `project-${projectId}`,
        params: {
          model: process.env.V2_GAP_LINK_MODEL || 'claude-3-5-sonnet-latest',
          max_tokens: 2000,
          system: CLAUDE_SYSTEM,
          messages: [{
            role: 'user',
            content: `JOBS:\n${jobList}\n\nGAPS:\n${gapList}\n\nReturn the JSON only.`,
          }],
        },
      });
    } catch (err) {
      console.warn(`[gap-job-linker] Claude call failed for project ${projectId} (batch ${i}):`, err.message);
      continue;
    }

    const text = (response?.content || [])
      .map((b) => (b?.type === 'text' ? b.text : ''))
      .join('')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(text));
    } catch (err) {
      console.warn(`[gap-job-linker] Could not parse Claude response for ${projectId}:`, err.message);
      continue;
    }

    if (!parsed || !Array.isArray(parsed.links)) continue;

    const validGapIds = new Set(batch.map((g) => g.id));
    const jobIndex = new Map(jobs.map((j) => [j.id, j]));

    for (const link of parsed.links) {
      if (!link || typeof link.gapId !== 'string' || typeof link.jobId !== 'string') continue;
      if (!validGapIds.has(link.gapId)) continue;
      const job = jobIndex.get(link.jobId);
      if (!job) continue;
      const conf = Number(link.confidence);
      if (!Number.isFinite(conf) || conf < MIN_CLAUDE_CONFIDENCE) continue;

      const list = result.get(link.gapId) || [];
      list.push({
        jobId: link.jobId,
        personaId: getPersonaId(job),
        confidence: Math.min(1, Math.max(0, conf)),
        reason: String(link.reason || '').slice(0, 200),
        method: 'claude',
      });
      result.set(link.gapId, list);
    }
  }

  for (const [gapId, list] of result.entries()) {
    list.sort((a, b) => b.confidence - a.confidence);
    result.set(gapId, list.slice(0, MAX_LINKS_PER_GAP));
  }

  return result;
}

/**
 * Link unlinked gaps for a project to jobs in its product map.
 *
 * Options:
 *   - `force`: re-link rows whose `v2_job_links` is already populated.
 *     Useful after the product map regenerates and old links are stale.
 *   - `useClaude`: when false, only the heuristic pass runs (used by the
 *     backfill script in environments without Anthropic creds).
 *
 * Returns a small summary so callers can log progress without re-querying.
 */
async function linkGapsToJobs(projectId, opts = {}) {
  const { force = false, useClaude = true } = opts;

  const map = await productMap.getMapByProject(projectId);
  if (!map || !map.map) {
    return { ok: true, reason: 'no-map', total: 0, linked: 0, claudeUsed: false };
  }

  const jobs = Array.isArray(map.jobs) ? map.jobs : [];
  const personas = Array.isArray(map.personas) ? map.personas : [];
  const entities = Array.isArray(map.entities) ? map.entities : [];
  const edges = Array.isArray(map.edges) ? map.edges : [];
  if (jobs.length === 0) {
    return { ok: true, reason: 'no-jobs', total: 0, linked: 0, claudeUsed: false };
  }

  const candidates = force
    ? await suggestions.findV2GapsByProjectId(projectId)
    : await suggestions.findUnlinkedV2GapsByProjectId(projectId);
  if (candidates.length === 0) {
    return { ok: true, reason: 'no-candidates', total: 0, linked: 0, claudeUsed: false };
  }

  const personasById = new Map(personas.map((p) => [p.id, p]));
  const linkedById = new Map();

  // Heuristic pass — fast, no API calls.
  for (const row of candidates) {
    const links = heuristicLink(row, jobs, entities, edges);
    if (links.length > 0) linkedById.set(row.id, links);
  }

  // Claude pass for the rest.
  let claudeUsed = false;
  if (useClaude) {
    const remaining = candidates.filter((c) => !linkedById.has(c.id));
    if (remaining.length > 0) {
      claudeUsed = true;
      try {
        const claudeLinks = await claudeLinkBatch(remaining, jobs, personasById, projectId);
        for (const [gapId, links] of claudeLinks.entries()) {
          linkedById.set(gapId, links);
        }
      } catch (err) {
        console.warn(`[gap-job-linker] Claude pass failed for ${projectId}:`, err.message);
      }
    }
  }

  // Persist — empty array means "we tried, no jobs apply" (still better
  // than `null` because we won't retry on every page load).
  let linked = 0;
  for (const row of candidates) {
    const list = linkedById.get(row.id) || [];
    try {
      await suggestions.setV2JobLinks(row.id, projectId, list);
      if (list.length > 0) linked += 1;
    } catch (err) {
      console.warn(`[gap-job-linker] persist failed for gap ${row.id}:`, err.message);
    }
  }

  return {
    ok: true,
    total: candidates.length,
    linked,
    claudeUsed,
  };
}

module.exports = {
  linkGapsToJobs,
  // Exposed for tests / the backfill script.
  heuristicLink,
  CATEGORY_TO_CAPABILITY,
};

/**
 * Job-conditioned invariant generation — analysis-time, findings-first.
 *
 * For each job in the product map, ONE bounded Claude call produces 2-4
 * guarantee-altitude invariants grounded on the job's code (via job-code.js).
 * Each invariant includes an inline `satisfied` (holds/broken) verdict so the
 * UI can lead with findings without a second LLM pass.
 *
 * Runs speculatively at analysis time for ALL jobs (not only confirmed ones).
 * Confirmation is instant elsewhere (cascade-confirm.js).
 */

const crypto = require('crypto');
const { CLAUDE_MODEL, HAIKU_MODEL, anthropic, truncate } = require('../../lib/constants');
const { createMessageTracked, extractText } = require('../../lib/anthropic-tracked');
const { stripJsonFence } = require('../map-extractor');
const { intentStatements, statementJobs, productMap, analysisFiles } = require('../../lib/db');
const { hashLinkedFiles } = require('./satisfaction');
const { scoreInvariantConfidence } = require('./confidence');
const { resolveJobFiles, extractJobAnchors } = require('./job-code');

const VALID_KINDS = new Set(['behavior', 'constraint', 'non_goal']);
const PER_JOB_SOURCE_BUDGET = 10000;
const PER_FILE_CAP = 5000;
const CONCURRENCY = 3;
const MIN_ANCHORS = 1;

const SYSTEM_PROMPT = `You are a senior engineer identifying the testable GUARANTEES that must hold in code for a job-to-be-done to be satisfied.

Given a persona, their job, and the code that serves it, list 2-4 guarantees — each maps to ONE testable behavior/invariant tied to a code surface.
- Good:      "Checkout requires a successful payment authorization before an order is created"
- Too coarse:"Handles payments"
- Too fine:  "Validates amount > 0 on line 40"

For EACH guarantee return:
- text, kind (behavior|constraint|non_goal)
- links: [{ file_path, symbol }] — ONLY from the provided anchors
- satisfied: true if the current code upholds this guarantee, false if broken/missing
- confidence: 0-1 (optional tiebreaker)

Respond with ONLY a JSON array. No prose, no fences.`;

function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?;:,]+$/g, '')
    .trim();
}

function mergeKey(kind, link) {
  const fp = link && link.file_path ? link.file_path : '';
  const sym = link && link.symbol ? link.symbol : '';
  return `${kind || ''}::${fp}::${sym}`;
}

function buildSourceBlock(filePaths, contents) {
  const parts = [];
  let used = 0;
  for (const p of filePaths.sort()) {
    if (used >= PER_JOB_SOURCE_BUDGET) break;
    const content = contents[p];
    if (typeof content !== 'string' || !content) continue;
    const cap = Math.min(PER_FILE_CAP, PER_JOB_SOURCE_BUDGET - used);
    parts.push(`--- ${p} ---\n${truncate(content, cap)}`);
    used += cap;
  }
  return parts.join('\n\n');
}

function formatAnchors(anchors) {
  return anchors.map((a) => `- ${a.file_path}${a.symbol ? `:${a.symbol}` : ''} (${a.kind || 'anchor'})`).join('\n');
}

function parseInvariants(rawText, validAnchors) {
  let parsed;
  try {
    parsed = JSON.parse(stripJsonFence(String(rawText || '')));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const anchorSet = new Set(
    validAnchors.map((a) => `${a.file_path}::${a.symbol || ''}`)
  );

  const out = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const text = String(raw.text || '').trim();
    if (!text) continue;
    const kind = VALID_KINDS.has(raw.kind) ? raw.kind : 'behavior';
    const linksIn = Array.isArray(raw.links) ? raw.links : [];
    const links = [];
    for (const l of linksIn) {
      if (!l || !l.file_path) continue;
      const key = `${l.file_path}::${l.symbol || ''}`;
      if (!anchorSet.has(key)) continue;
      links.push({
        file_path: l.file_path,
        symbol: l.symbol ?? null,
        link_status: 'healthy',
      });
    }
    if (links.length === 0) continue;
    out.push({
      text,
      kind,
      links,
      satisfied: raw.satisfied === false ? false : raw.satisfied === true,
      llmConfidence: typeof raw.confidence === 'number' ? raw.confidence : null,
    });
    if (out.length >= 6) break;
  }
  return out;
}

async function generateForJob(projectId, job, persona, map, contents) {
  const allPaths = Object.keys(contents || {});
  const { files, needsEdges, usedFallback } = resolveJobFiles(job, map, allPaths);
  if (files.length === 0) {
    return { jobId: job.id, generated: 0, reason: 'no_files', needsEdges, usedFallback };
  }

  const anchors = extractJobAnchors(contents, files);
  if (anchors.length < MIN_ANCHORS) {
    return { jobId: job.id, generated: 0, reason: 'no_anchors', needsEdges, usedFallback };
  }

  const personaLabel = persona
    ? `${persona.emoji || ''} ${persona.name}`.trim()
    : 'User';

  const userContent = [
    `Persona: ${personaLabel}`,
    `Job: ${job.title} (${job.priority || 'medium'} priority)`,
    '',
    'Anchors (cite ONLY these):',
    formatAnchors(anchors),
    '',
    'Source:',
    buildSourceBlock(files, contents),
  ].join('\n');

  const response = await createMessageTracked({
    client: anthropic,
    analysisId: projectId,
    phase: 'intent.job-invariants',
    params: {
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    },
  });

  const parsed = parseInvariants(extractText(response), anchors);
  if (parsed.length === 0) {
    return { jobId: job.id, generated: 0, reason: 'empty_parse', needsEdges, usedFallback };
  }

  const jobFileHash = hashLinkedFiles(contents, files.map((f) => ({ file_path: f })));
  const rows = parsed.map((inv) => {
    const confidence = scoreInvariantConfidence({
      links: inv.links,
      satisfied: inv.satisfied,
      llmConfidence: inv.llmConfidence,
    });
    return {
      id: crypto.randomUUID(),
      project_id: projectId,
      text: inv.text,
      kind: inv.kind,
      status: 'candidate',
      source: 'inferred',
      feature_area: job.title,
      group_label: job.title,
      links: inv.links,
      code_hash: jobFileHash,
      satisfied: inv.satisfied,
      last_checked_at: new Date().toISOString(),
      scope: 'job',
      confirmed_via: null,
      confidence,
      archived: false,
      _jobId: job.id,
      _normText: normalizeText(inv.text),
      _mergeKey: mergeKey(inv.kind, inv.links[0]),
    };
  });

  return { jobId: job.id, rows, needsEdges, usedFallback, generated: rows.length };
}

async function deleteCandidatesForJob(projectId, jobId) {
  const stmts = await statementJobs.findStatementsForJob(jobId, { status: 'candidate' });
  for (const s of stmts) {
    if (s.project_id !== projectId) continue;
    await intentStatements.delete(s.id, projectId);
  }
}

async function persistJobInvariants(projectId, jobId, rows) {
  await deleteCandidatesForJob(projectId, jobId);
  if (!rows || rows.length === 0) return 0;

  const toInsert = rows.map(({ _jobId, _normText, _mergeKey, ...row }) => row);
  await intentStatements.createBatch(toInsert);
  for (const row of rows) {
    await statementJobs.link(row.id, jobId);
  }
  return rows.length;
}

/**
 * Merge near-duplicate invariants across jobs (same kind + primary symbol).
 * Keeps the first statement, links it to all matching jobs, deletes dupes.
 */
async function mergeCrossJobDuplicates(projectId, createdPairs) {
  const byKey = new Map();
  for (const { statementId, jobId, mergeKey, normText } of createdPairs) {
    const key = mergeKey || normText;
    if (!byKey.has(key)) byKey.set(key, { statementId, jobIds: new Set([jobId]) });
    else {
      const entry = byKey.get(key);
      if (entry.statementId !== statementId) {
        await statementJobs.link(entry.statementId, jobId);
        await intentStatements.delete(statementId, projectId);
      } else {
        entry.jobIds.add(jobId);
        await statementJobs.link(statementId, jobId);
      }
    }
  }
  return byKey.size;
}

async function runPool(items, limit, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx], idx);
      } catch (err) {
        results[idx] = { error: err.message };
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Generate invariants for jobs in a project (analysis-time).
 * @param {string} projectId
 * @param {object} codebaseModel
 * @param {{ jobIds?: string[] }} [opts] - limit to specific jobs (re-analysis)
 */
async function runJobInvariantGeneration(projectId, codebaseModel, opts = {}) {
  const map = await productMap.getMapByProject(projectId);
  if (!map || !Array.isArray(map.jobs) || map.jobs.length === 0) {
    return { generated: false, reason: 'no_map', jobs: 0 };
  }

  let contents = (codebaseModel && codebaseModel.fileContents) || {};
  if (!contents || Object.keys(contents).length === 0) {
    try {
      contents = await analysisFiles.getContentsMap(projectId);
    } catch {
      contents = {};
    }
  }

  const personaById = new Map((map.personas || []).map((p) => [p.id, p]));
  let jobs = map.jobs;
  if (Array.isArray(opts.jobIds) && opts.jobIds.length > 0) {
    const allow = new Set(opts.jobIds);
    jobs = jobs.filter((j) => allow.has(j.id));
  }

  const mapForResolver = {
    entities: map.entities,
    edges: map.edges,
  };

  const results = await runPool(jobs, CONCURRENCY, async (job) => {
    const persona = personaById.get(job.persona_id);
    const gen = await generateForJob(projectId, job, persona, mapForResolver, contents);
    if (!gen.rows || gen.rows.length === 0) return gen;
    const count = await persistJobInvariants(projectId, job.id, gen.rows);
    return { ...gen, persisted: count };
  });

  const createdPairs = [];
  for (const r of results) {
    if (!r || !r.rows) continue;
    for (const row of r.rows) {
      createdPairs.push({
        statementId: row.id,
        jobId: r.jobId,
        mergeKey: row._mergeKey,
        normText: row._normText,
      });
    }
  }
  if (createdPairs.length > 1) {
    await mergeCrossJobDuplicates(projectId, createdPairs);
  }

  const total = results.reduce((n, r) => n + (r && r.persisted ? r.persisted : 0), 0);
  return {
    generated: total > 0,
    jobs: jobs.length,
    persisted: total,
    results,
  };
}

/**
 * Regenerate invariants for a single job (after job edit or targeted re-analysis).
 */
async function regenerateJobInvariants(projectId, jobId, codebaseModel) {
  return runJobInvariantGeneration(projectId, codebaseModel, { jobIds: [jobId] });
}

module.exports = {
  runJobInvariantGeneration,
  regenerateJobInvariants,
  generateForJob,
  parseInvariants,
  deleteCandidatesForJob,
  mergeKey,
  normalizeText,
};

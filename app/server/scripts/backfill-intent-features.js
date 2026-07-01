#!/usr/bin/env node
/**
 * Backfill the intent feature / job-to-be-done layer for already-analyzed
 * projects.
 *
 * Why this exists: the feature-synthesis stage (`services/intent/features.js`)
 * runs automatically inside the intent pipeline on every NEW analysis. Projects
 * analyzed before that stage shipped still have flat, component-grouped
 * statements and no `intent_features` rows, so their Context tab won't show the
 * Persona -> Job -> Feature plan until they're re-synthesized. This script runs
 * `runFeatureSynthesis` once per existing project to populate the layer
 * immediately (same idea as the one-time grouping backfill before it).
 *
 * Idempotent — `runFeatureSynthesis` replaces the project's feature set and
 * re-labels statements each run, so it's safe to re-run after partial failures.
 *
 * Usage:
 *   DATABASE_URL=<connection-url> \
 *   ANTHROPIC_API_KEY=<key> \
 *   node app/server/scripts/backfill-intent-features.js
 *
 * Optional env:
 *   BACKFILL_LIMIT    — cap number of projects (default: no cap)
 *   BACKFILL_PROJECT  — only run for this single project id (debugging)
 *   DRY_RUN=1         — just print what would be done
 *
 * Costs Anthropic credits — one catalog call + a few assignment calls per
 * project. Run during low-traffic windows.
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '..', '.env'),
});

const dbModule = require('../lib/db');
const { deployments, closeDb } = dbModule;
const { runFeatureSynthesis } = require('../services/intent/features');

const DRY_RUN = process.env.DRY_RUN === '1';
const LIMIT = process.env.BACKFILL_LIMIT
  ? parseInt(process.env.BACKFILL_LIMIT, 10)
  : Infinity;
const ONLY_PROJECT = process.env.BACKFILL_PROJECT || null;

// Only projects that actually have intent statements are worth synthesizing.
async function listCandidates() {
  if (ONLY_PROJECT) {
    const p = await deployments.findById(ONLY_PROJECT);
    return p ? [p.id] : [];
  }
  const { rows } = await dbModule.getDb().query(
    `SELECT DISTINCT project_id FROM intent_statements
      WHERE status <> 'rejected'
      ORDER BY project_id`
  );
  return rows.map((r) => r.project_id);
}

function pickDescription(project) {
  if (!project) return null;
  return (
    (project.features_summary && String(project.features_summary).trim()) ||
    (project.description && String(project.description).trim()) ||
    null
  );
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set (needed for synthesis).');
    process.exit(1);
  }

  console.log(
    `[backfill-intent-features] starting (dry_run=${DRY_RUN}, limit=${LIMIT === Infinity ? 'none' : LIMIT}` +
      `${ONLY_PROJECT ? `, only=${ONLY_PROJECT}` : ''})`
  );

  const projectIds = await listCandidates();
  console.log(`[backfill-intent-features] ${projectIds.length} project(s) with intent statements`);

  const stats = { total: projectIds.length, attempted: 0, synthesized: 0, skipped: 0, failed: 0 };

  for (const projectId of projectIds.slice(0, LIMIT === Infinity ? projectIds.length : LIMIT)) {
    const project = await deployments.findById(projectId).catch(() => null);
    const description = pickDescription(project);

    if (DRY_RUN) {
      console.log(`[backfill-intent-features] DRY_RUN ${projectId} — would synthesize`);
      continue;
    }

    stats.attempted += 1;
    try {
      const t0 = Date.now();
      const result = await runFeatureSynthesis(
        projectId,
        description ? { meta: { description } } : undefined
      );
      const ms = Date.now() - t0;
      if (result && result.synthesized) {
        stats.synthesized += 1;
        console.log(
          `[backfill-intent-features] ${projectId} — ${result.features} features, ` +
            `${result.assigned}/${result.total} statements, usedMap=${result.usedMap} (${ms}ms)`
        );
      } else {
        stats.skipped += 1;
        console.log(`[backfill-intent-features] ${projectId} — skipped (${result ? result.reason : 'no_result'})`);
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`[backfill-intent-features] ${projectId} — FAILED: ${err.message}`);
    }
  }

  console.log('[backfill-intent-features] done.', JSON.stringify(stats));
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[backfill-intent-features] fatal:', err);
    try { await closeDb(); } catch (_) {}
    process.exit(2);
  });

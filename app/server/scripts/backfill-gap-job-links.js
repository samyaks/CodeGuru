#!/usr/bin/env node
/**
 * Backfill `suggestions.v2_job_links` for projects analyzed before
 * migration 013 / the gap-job-linker hooks landed.
 *
 * What it does:
 *   For every analyzed project that has a product map, runs
 *   `services/v2/gap-job-linker.js#linkGapsToJobs` once. The linker is
 *   idempotent — only rows where `v2_job_links IS NULL` are touched,
 *   so re-running is safe and cheap.
 *
 * Usage:
 *   DATABASE_URL=<connection-url> \
 *   ANTHROPIC_API_KEY=<key> \
 *   node app/server/scripts/backfill-gap-job-links.js
 *
 * Optional env:
 *   BACKFILL_LIMIT      — cap number of projects (default: no cap)
 *   BACKFILL_PROJECT    — only run for this single project id (debugging)
 *   BACKFILL_NO_CLAUDE  — set to 1 to run heuristic-only (no LLM calls)
 *   DRY_RUN=1           — list candidates and bail
 *
 * Costs: roughly one Claude call per project (one batched message that
 * covers up to 25 unlinked gaps). Heuristic-matched gaps don't cost
 * anything. Run during low-traffic windows for projects with many gaps.
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '..', '.env'),
});

const dbModule = require('../lib/db');
const { deployments, closeDb } = dbModule;
const { productMap } = require('../lib/db-map');
const { linkGapsToJobs } = require('../services/v2/gap-job-linker');

const DRY_RUN = process.env.DRY_RUN === '1';
const NO_CLAUDE = process.env.BACKFILL_NO_CLAUDE === '1';
const LIMIT = process.env.BACKFILL_LIMIT
  ? parseInt(process.env.BACKFILL_LIMIT, 10)
  : Infinity;
const ONLY_PROJECT = process.env.BACKFILL_PROJECT || null;

async function listCandidates() {
  if (ONLY_PROJECT) {
    const p = await deployments.findById(ONLY_PROJECT);
    return p ? [p] : [];
  }
  // Only projects that have an analyzed status are worth attempting —
  // anything earlier in the pipeline either has no suggestions or no
  // product map (or both).
  const { rows } = await dbModule.getDb().query(
    `SELECT * FROM deployments
      WHERE status IN ('scored', 'ready', 'live')
      ORDER BY created_at DESC
      LIMIT 1000`
  );
  return rows;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!DRY_RUN && !NO_CLAUDE && !process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY not set; pass BACKFILL_NO_CLAUDE=1 to run heuristic-only.');
    process.exit(1);
  }

  console.log(
    `[backfill-gap-job-links] starting (dry_run=${DRY_RUN}, no_claude=${NO_CLAUDE},` +
      ` limit=${LIMIT === Infinity ? 'none' : LIMIT}` +
      `${ONLY_PROJECT ? `, only=${ONLY_PROJECT}` : ''})`
  );

  const candidates = await listCandidates();
  console.log(`[backfill-gap-job-links] ${candidates.length} project(s) eligible`);

  const stats = {
    total: candidates.length,
    skipped_no_map: 0,
    skipped_no_jobs: 0,
    skipped_no_candidates: 0,
    attempted: 0,
    linked_total: 0,
    failed: 0,
  };

  for (const project of candidates.slice(0, LIMIT === Infinity ? candidates.length : LIMIT)) {
    const projectId = project.id;

    // Quick existence check so DRY_RUN is informative.
    let map = null;
    try {
      map = await productMap.getMapByProject(projectId);
    } catch (err) {
      console.warn(`[backfill-gap-job-links] ${projectId} — getMapByProject failed: ${err.message}`);
    }
    if (!map || !map.map) {
      stats.skipped_no_map += 1;
      continue;
    }
    if (!Array.isArray(map.jobs) || map.jobs.length === 0) {
      stats.skipped_no_jobs += 1;
      continue;
    }

    if (DRY_RUN) {
      console.log(`[backfill-gap-job-links] DRY_RUN ${projectId} — has map (${map.jobs.length} jobs); would link`);
      continue;
    }

    stats.attempted += 1;
    try {
      const t0 = Date.now();
      const summary = await linkGapsToJobs(projectId, { useClaude: !NO_CLAUDE });
      const ms = Date.now() - t0;
      stats.linked_total += summary.linked || 0;
      if (summary.reason === 'no-candidates') {
        stats.skipped_no_candidates += 1;
        console.log(`[backfill-gap-job-links] ${projectId} — already linked, nothing to do`);
      } else {
        console.log(
          `[backfill-gap-job-links] ${projectId} — linked ${summary.linked}/${summary.total} gaps in ${ms}ms ` +
            `(claude=${summary.claudeUsed})`
        );
      }
    } catch (err) {
      stats.failed += 1;
      console.error(`[backfill-gap-job-links] ${projectId} — FAILED: ${err.message}`);
    }
  }

  console.log('[backfill-gap-job-links] done.', JSON.stringify(stats));
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[backfill-gap-job-links] fatal:', err);
    try { await closeDb(); } catch (_) {}
    process.exit(2);
  });

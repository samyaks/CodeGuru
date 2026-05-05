#!/usr/bin/env node
/**
 * Backfill product maps for projects that don't have one yet.
 *
 * Why this exists: Phase 5 of the v2 (Takeoff) migration deleted the v1
 * `ProductMapOnboarding` wizard, which was the only path to create a
 * product map for an analyzed project. Until the analyzer auto-extract
 * hook is deployed (`routes/takeoff.js#autoCreateProductMap`), every
 * existing project that never went through the wizard shows an empty
 * Map tab. This script gives those projects a one-shot map by running
 * the same `extractProductIntent` flow the wizard used.
 *
 * Idempotent — projects that already have a `product_maps` row are
 * skipped. Safe to re-run after partial failures.
 *
 * Usage:
 *   DATABASE_URL=<connection-url> \
 *   ANTHROPIC_API_KEY=<key> \
 *   node app/server/scripts/backfill-product-maps.js
 *
 * Optional env:
 *   BACKFILL_LIMIT     — cap number of projects (default: no cap)
 *   BACKFILL_PROJECT   — only run for this single project id (debugging)
 *   DRY_RUN=1          — just print what would be done
 *
 * Costs Anthropic credits — one extract + one set of link calls per
 * project. Run during low-traffic windows.
 */

require('dotenv').config({
  path: require('path').resolve(__dirname, '..', '..', '.env'),
});

const dbModule = require('../lib/db');
const { deployments, productMap, closeDb } = dbModule;
const productMapSvc = require('../services/product-map');

const DRY_RUN = process.env.DRY_RUN === '1';
const LIMIT = process.env.BACKFILL_LIMIT
  ? parseInt(process.env.BACKFILL_LIMIT, 10)
  : Infinity;
const ONLY_PROJECT = process.env.BACKFILL_PROJECT || null;

async function listCandidates() {
  if (ONLY_PROJECT) {
    const p = await deployments.findById(ONLY_PROJECT);
    return p ? [p] : [];
  }
  // Every deployment that's been analyzed enough to have a description
  // signal. `status` should be at least 'scored' or 'ready'.
  const { rows } = await dbModule.getDb().query(
    `SELECT * FROM deployments
      WHERE status IN ('scored', 'ready', 'live')
      ORDER BY created_at DESC
      LIMIT 1000`
  );
  return rows;
}

function pickDescription(project) {
  return (
    (project.features_summary && String(project.features_summary).trim()) ||
    (project.description && String(project.description).trim()) ||
    null
  );
}

async function alreadyHasMap(projectId) {
  try {
    const existing = await productMap.getMapByProject(projectId);
    return !!(existing && existing.map);
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }
  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error('ERROR: ANTHROPIC_API_KEY is not set (needed for extraction).');
    process.exit(1);
  }

  console.log(
    `[backfill-product-maps] starting (dry_run=${DRY_RUN}, limit=${LIMIT === Infinity ? 'none' : LIMIT}` +
      `${ONLY_PROJECT ? `, only=${ONLY_PROJECT}` : ''})`
  );

  const candidates = await listCandidates();
  console.log(`[backfill-product-maps] ${candidates.length} project(s) eligible`);

  const stats = { total: candidates.length, skipped_has_map: 0, skipped_no_desc: 0, attempted: 0, succeeded: 0, failed: 0 };

  for (const project of candidates.slice(0, LIMIT === Infinity ? candidates.length : LIMIT)) {
    const projectId = project.id;

    if (await alreadyHasMap(projectId)) {
      stats.skipped_has_map += 1;
      continue;
    }

    const description = pickDescription(project);
    if (!description) {
      stats.skipped_no_desc += 1;
      console.log(`[backfill-product-maps] ${projectId} — no description signal, skipping`);
      continue;
    }

    stats.attempted += 1;
    if (DRY_RUN) {
      console.log(`[backfill-product-maps] DRY_RUN ${projectId} — would extract from ${description.length} chars`);
      continue;
    }

    try {
      const t0 = Date.now();
      const result = await productMapSvc.createProductMap(projectId, null, description);
      const ms = Date.now() - t0;
      console.log(
        `[backfill-product-maps] ${projectId} — created map in ${ms}ms ` +
          `(${result.personas.length} personas, ${result.jobs.length} jobs, ${result.entities.length} entities)`
      );
      stats.succeeded += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`[backfill-product-maps] ${projectId} — FAILED: ${err.message}`);
    }
  }

  console.log('[backfill-product-maps] done.', JSON.stringify(stats));
}

main()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[backfill-product-maps] fatal:', err);
    try { await closeDb(); } catch (_) {}
    process.exit(2);
  });

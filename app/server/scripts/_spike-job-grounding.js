#!/usr/bin/env node
/**
 * THROWAWAY SPIKE (Phase 0) — measure job -> code grounding coverage.
 *
 * The "jobs as the confirmation unit" plan conditions invariant generation on
 * the code a job is linked to. That link is indirect and heuristic
 * (map_edges type='needs' job -> entity, entity.file_path), so before building
 * Phase 4 we measure how many jobs actually resolve to real files/anchors.
 *
 * For every project that has a product map, per job we report:
 *   - needsEdges        : # of map_edges (type='needs') from the job
 *   - entityFiles       : # distinct entity file_paths reachable via those edges
 *   - resolvableFiles   : # of those files present in analysis_files content
 *   - anchors           : # structure anchors re-extractable from those files
 *   - fallbackFiles     : # files a title<->path/name fallback would add
 *
 * Decision gate: if a large share of jobs land at 0-1 resolvableFiles, Phase 4
 * MUST ship the title->anchor fallback selector (built into job-code.js).
 *
 * Usage:
 *   DATABASE_URL=<url> node app/server/scripts/_spike-job-grounding.js
 *
 * Delete this file after the measurement — it is not part of the app.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const dbModule = require('../lib/db');
const { productMap, analysisFiles, closeDb } = dbModule;
const { extractStructureAnchors } = require('../services/structure-extractor');

function tokens(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
}

async function listProjectsWithMaps() {
  const { rows } = await dbModule.getDb().query(
    `SELECT DISTINCT project_id FROM product_maps ORDER BY project_id`
  );
  return rows.map((r) => r.project_id);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is not set.');
    process.exit(1);
  }

  const projectIds = await listProjectsWithMaps();
  console.log(`[spike] ${projectIds.length} project(s) with a product map`);

  const perJob = [];

  for (const projectId of projectIds) {
    const map = await productMap.getMapByProject(projectId).catch(() => null);
    if (!map || !Array.isArray(map.jobs) || map.jobs.length === 0) continue;

    const contents = await analysisFiles.getContentsMap(projectId).catch(() => ({}));
    const anchors = extractStructureAnchors(contents);
    const anchorsByFile = new Map();
    for (const a of anchors) {
      if (!a || !a.file_path) continue;
      anchorsByFile.set(a.file_path, (anchorsByFile.get(a.file_path) || 0) + 1);
    }
    const allFiles = Object.keys(contents);

    const entityById = new Map((map.entities || []).map((e) => [e.id, e]));
    const needsByJob = new Map();
    for (const e of map.edges || []) {
      if (e.type !== 'needs') continue;
      if (!needsByJob.has(e.from_id)) needsByJob.set(e.from_id, []);
      needsByJob.get(e.from_id).push(e.to_id);
    }

    for (const job of map.jobs) {
      const toIds = needsByJob.get(job.id) || [];
      const entityFiles = new Set();
      for (const toId of toIds) {
        const ent = entityById.get(toId);
        if (ent && ent.file_path) entityFiles.add(ent.file_path);
      }
      const resolvable = [...entityFiles].filter((f) => contents[f] != null);

      // Fallback: files whose path/name shares tokens with the job title.
      const jobToks = new Set(tokens(job.title));
      const fallback = allFiles.filter((f) => {
        if (entityFiles.has(f)) return false;
        return tokens(f).some((t) => jobToks.has(t));
      });

      const anchorCount = resolvable.reduce((n, f) => n + (anchorsByFile.get(f) || 0), 0);
      perJob.push({
        project: projectId,
        job: job.title,
        needsEdges: toIds.length,
        entityFiles: entityFiles.size,
        resolvableFiles: resolvable.length,
        anchors: anchorCount,
        fallbackFiles: fallback.length,
      });
    }
  }

  const n = perJob.length;
  const zeroOrOne = perJob.filter((j) => j.resolvableFiles <= 1).length;
  const zeroWithFallback = perJob.filter((j) => j.resolvableFiles === 0 && j.fallbackFiles > 0).length;
  console.log(`\n[spike] ${n} jobs total`);
  if (n > 0) {
    console.log(`  jobs with <=1 resolvable file: ${zeroOrOne} (${Math.round((zeroOrOne / n) * 100)}%)`);
    console.log(`  jobs with 0 files but a fallback match: ${zeroWithFallback}`);
    console.log('\n[spike] per-job detail:');
    for (const j of perJob) {
      console.log(
        `  ${j.project.slice(0, 8)} | ${j.job.slice(0, 40).padEnd(40)} | ` +
        `edges=${j.needsEdges} entFiles=${j.entityFiles} resolvable=${j.resolvableFiles} ` +
        `anchors=${j.anchors} fallback=${j.fallbackFiles}`
      );
    }
    console.log('\n[spike] GATE: if "<=1 resolvable file" is a large share, keep the title->anchor fallback in job-code.js.');
  }
}

main()
  .then(async () => { await closeDb(); process.exit(0); })
  .catch(async (err) => { console.error('[spike] fatal:', err); try { await closeDb(); } catch (_) {} process.exit(2); });

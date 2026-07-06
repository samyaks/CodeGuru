/**
 * Re-analysis reconciliation for the job/invariant model.
 *
 * Preserves confirmed state across re-runs. Only regenerates invariants for
 * jobs whose linked code changed (hash over resolved job files).
 */

const crypto = require('crypto');
const { productMap, analysisFiles } = require('../../lib/db');
const { statementJobs } = require('../../lib/db');
const { resolveJobFiles } = require('./job-code');

function hashJobFiles(contents, filePaths) {
  const paths = [...filePaths].sort();
  if (paths.length === 0) return null;
  const hash = crypto.createHash('sha256');
  let any = false;
  for (const p of paths) {
    const c = contents && contents[p];
    if (typeof c !== 'string') continue;
    hash.update(p);
    hash.update('\0');
    hash.update(c);
    hash.update('\0');
    any = true;
  }
  return any ? hash.digest('hex') : null;
}

/**
 * Decide which jobs need invariant regeneration on re-analysis.
 * @returns {{ jobsToRegenerate: string[], skipped: string[], unchanged: boolean }}
 */
async function reconcileIntentOnReanalysis(projectId, codebaseModel) {
  const map = await productMap.getMapByProject(projectId);
  if (!map || !Array.isArray(map.jobs) || map.jobs.length === 0) {
    return { jobsToRegenerate: [], skipped: [], unchanged: false, reason: 'no_map' };
  }

  let contents = (codebaseModel && codebaseModel.fileContents) || {};
  if (!contents || Object.keys(contents).length === 0) {
    try {
      contents = await analysisFiles.getContentsMap(projectId);
    } catch {
      contents = {};
    }
  }

  const allPaths = Object.keys(contents);
  const mapForResolver = { entities: map.entities, edges: map.edges };
  const jobsToRegenerate = [];
  const skipped = [];

  for (const job of map.jobs) {
    const { files } = resolveJobFiles(job, mapForResolver, allPaths);
    const newHash = hashJobFiles(contents, files);
    const stmts = await statementJobs.findStatementsForJob(job.id);
    const live = stmts.filter((s) => s.status !== 'rejected' && !s.archived);

    if (live.length === 0) {
      jobsToRegenerate.push(job.id);
      continue;
    }

    const hasConfirmed = live.some((s) => s.status === 'confirmed');
    const storedHash = live.find((s) => s.code_hash)?.code_hash;

    if (hasConfirmed && newHash && storedHash === newHash) {
      skipped.push(job.id);
      continue;
    }

    if (newHash && storedHash && storedHash !== newHash) {
      jobsToRegenerate.push(job.id);
      continue;
    }

    if (live.every((s) => s.status === 'candidate')) {
      jobsToRegenerate.push(job.id);
    }
  }

  const unchanged = jobsToRegenerate.length === 0 && skipped.length === map.jobs.length;
  return { jobsToRegenerate, skipped, unchanged };
}

module.exports = { reconcileIntentOnReanalysis, hashJobFiles };

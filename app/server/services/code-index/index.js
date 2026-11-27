'use strict';

/**
 * Keeps each project's stored code index current. No model is called.
 *
 *   ensureBuilt(project)      start a build if there is no usable index
 *   onPush(project, payload)  a push to the indexed branch: apply it
 *   rebuild(project)          owner asked for a fresh build
 *   heal()                    nightly: catch up anything behind, failed or stuck
 *
 * One worker per project at a time: an in-process queue orders work here,
 * and a lease on the repo row keeps other processes out. When GitHub says
 * Takeoff can no longer read the repo, the index is deleted.
 */

const crypto = require('crypto');
const { codeIndex: defaultStore, deployments: defaultDeployments } = require('../../lib/db');
const { isAskEnabled } = require('../ask/config');
const { fullBuild, LIMITS } = require('./build');
const { applyPush } = require('./update');

const ACCESS_CODES = new Set(['GITHUB_APP_REQUIRED', 'GITHUB_SIGNIN_REQUIRED', 'FORBIDDEN']);

function isRateLimit(err) {
  const status = err.status || err.statusCode;
  if (err.code === 'GITHUB_RATE_LIMITED' || status === 429) return true;
  return status === 403 && /rate limit|abuse|secondary/i.test(String(err.message || ''));
}

/**
 * GitHub says Takeoff can no longer read the repo: the grant is gone or
 * the installation is. A rate limit, an outage, an expired token (401) or
 * a missing branch (404) is not; those fail and are retried. A 404 on the
 * repo itself is handled where the repo is read.
 */
function isAccessLoss(err) {
  if (!err) return false;
  if (isRateLimit(err)) return false;
  if (err.code && ACCESS_CODES.has(err.code)) return true;
  return !!err.installationGone;
}

/** A short reason to store, never a raw GitHub response body. */
function storedError(err) {
  if (!err) return 'Unknown error.';
  if (err.code === 'TAR_CORRUPT') return 'The repository download could not be read.';
  if (isRateLimit(err)) return 'GitHub is rate-limiting requests; it will be retried.';
  const status = err.status || err.statusCode;
  if (status === 404) return 'The branch could not be found on GitHub; it will be retried.';
  if (status >= 500) return 'GitHub did not respond as expected; it will be retried.';
  if (err.code === 'GITHUB_UNAVAILABLE') return 'GitHub did not respond as expected; it will be retried.';
  return 'The index could not be updated; it will be retried.';
}

const FULL_BUILDS_PER_DAY = 8;
const FAILED_BACKOFF_MS = 15 * 60 * 1000;
const MAX_RERUNS = 2;

function projectRepo(project) {
  return `${project.owner}/${project.repo}`.toLowerCase();
}

function indexable(project) {
  return !!(project && project.id && project.owner && project.repo && project.user_id
    && !String(project.repo_url || '').startsWith('local://'));
}

function createCodeIndex(deps = {}) {
  const store = deps.store || defaultStore;
  const projects = deps.deployments || defaultDeployments;
  const clientFor = deps.clientFor || ((project) => require('../github-access').clientForProject(project));
  const enabled = deps.enabled || (() => isAskEnabled(process.env));
  const limits = deps.limits || null;
  const log = deps.log || ((obj) => console.log(JSON.stringify({ event: 'code_index', ...obj })));

  const queues = new Map();
  function enqueue(projectId, fn) {
    const prev = queues.get(projectId) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    queues.set(projectId, next);
    next.then(() => {}, () => {}).then(() => { if (queues.get(projectId) === next) queues.delete(projectId); });
    return next;
  }

  /**
   * Bring the index to the default branch's head. `force` rebuilds from a
   * tarball even when the index is current or was too large. GitHub is
   * read only after the lease is held, so a push that landed before the
   * claim is always seen, and the index only moves to the current head.
   */
  async function sync(project, { force = false, forcedPush = false, reason = 'sync', rerun = 0 } = {}) {
    if (!enabled()) return { skipped: 'disabled' };
    if (!indexable(project)) return { skipped: 'not_indexable' };
    const projectId = project.id;
    const repoName = projectRepo(project);
    const token = crypto.randomUUID();
    let claimed = false;
    let full = false;

    try {
      const existing = await store.getRepo(projectId);
      if (existing && existing.status === 'too_large' && !force) return { skipped: 'too_large' };

      let row = await store.claim(projectId, { repo: repoName, token });
      // Busy: note the push for the worker holding the lease. If that lease
      // ended in between, nobody would see the note, so try once more.
      if (!row && !(await store.markBehind(projectId))) row = await store.claim(projectId, { repo: repoName, token });
      if (!row) return { skipped: 'busy' };
      claimed = true;
      const client = clientFor(project);

      let meta;
      try {
        meta = await client.fetchRepoMeta(project.owner, project.repo);
      } catch (err) {
        const status = err && (err.status || err.statusCode);
        if (status === 404 && !isRateLimit(err)) throw Object.assign(err, { repoGone: true });
        throw err;
      }
      if (!meta) throw Object.assign(new Error('repository not found'), { repoGone: true });
      const branch = meta.default_branch || 'main';
      // A renamed or moved repo is read under its current name.
      const [owner, repo] = /^[^/\s]+\/[^/\s]+$/.test(String(meta.full_name || ''))
        ? meta.full_name.split('/') : [project.owner, project.repo];
      const head = await client.fetchBranch(owner, repo, branch);
      const sha = head && head.commit && head.commit.sha;
      if (!sha) throw Object.assign(new Error('branch has no head commit'), { status: 404 });

      const same = row.repo === repoName && row.branch === branch;
      full = force || forcedPush || !same || !row.indexed_sha || !['ready', 'behind'].includes(row.status);

      if (!full && row.indexed_sha === sha) {
        const done = await store.release(projectId, token, { status: 'ready', indexedSha: sha });
        claimed = false;
        await maybeRerun(project, done, rerun);
        return { status: 'ready', indexedSha: sha, unchanged: true };
      }

      // Too many full builds today: keep what is there and try tomorrow. Only
      // a complete index of this branch may still be served, marked behind.
      const skipForBudget = async () => {
        const usable = same && row.indexed_sha && ['ready', 'behind'].includes(row.status);
        await store.release(projectId, token, usable
          ? { status: 'behind' }
          : { status: 'failed', error: 'Too many rebuilds today; it will be retried.' });
        claimed = false;
        log({ projectId, action: 'skipped', reason: 'build_budget' });
        return { skipped: 'build_budget' };
      };
      if (full && !force && overBudget(row)) return await skipForBudget();

      let result = null;
      if (!full) {
        result = await applyPush({
          projectId, owner, repo,
          fromSha: row.indexed_sha, toSha: sha, client, store, token,
        });
        if (result.needFull) {
          log({ projectId, action: 'full_build_needed', reason: result.reason });
          // The delta may have written part of the change; nothing of it is served.
          if (!force && overBudget(row)) {
            row.status = 'failed';
            return await skipForBudget();
          }
          full = true;
          result = null;
        } else if (overLimits(await store.counts(projectId))) {
          await store.clearFiles(projectId, token);
          result = { status: 'too_large', indexedSha: sha, error: 'The repository is too large to index.' };
        }
      }
      if (full) {
        await store.setBuilding(projectId, token, { repo: repoName, branch });
        if (!same) await store.clearFiles(projectId, token);
        result = await fullBuild({
          projectId, owner, repo, sha, client, store, token, limits,
        });
      }
      const done = await store.release(projectId, token, {
        status: result.status, indexedSha: result.indexedSha, error: result.error || null,
        full, update: !full, attempt: full,
      });
      claimed = false;
      log({ projectId, action: full ? 'built' : 'updated', reason, status: result.status, sha: sha.slice(0, 12) });
      await maybeRerun(project, done, rerun);
      return { status: result.status, indexedSha: result.indexedSha, full };
    } catch (err) {
      if (err && err.code === 'CODE_INDEX_LEASE_LOST') {
        log({ projectId, action: 'lease_lost', reason });
        return { skipped: 'lease_lost' };
      }
      if (claimed && (err.repoGone || isAccessLoss(err))) {
        await store.deleteForProject(projectId).catch(() => {});
        log({ projectId, action: 'deleted_no_access', reason });
        return { status: 'deleted' };
      }
      log({ projectId, action: 'failed', reason, error: String(err && err.message || err).slice(0, 200) });
      if (claimed) {
        await store.release(projectId, token, { status: 'failed', error: storedError(err), attempt: full })
          .catch(() => {});
      }
      return { status: 'failed' };
    }
  }

  function overBudget(row) {
    const start = row.full_window_start ? new Date(row.full_window_start).getTime() : 0;
    return Date.now() - start < 24 * 60 * 60 * 1000 && (row.full_builds || 0) >= FULL_BUILDS_PER_DAY;
  }

  function overLimits(counts) {
    const lim = { ...LIMITS, ...(limits || {}) };
    return counts.files > lim.maxFiles || counts.textBytes > lim.maxTextBytes;
  }

  /** A push arrived while the lease was held: run once more, a couple of times at most. */
  async function maybeRerun(project, done, rerun) {
    if (!done || !done.dirty || rerun >= MAX_RERUNS) return;
    run(project, { reason: 'rerun', rerun: rerun + 1 }).catch(() => {});
  }

  function run(project, opts) {
    return enqueue(project.id, () => sync(project, opts));
  }

  /** Start a build when there is no usable index. Resolves with the current status row (or null). */
  async function ensureBuilt(project) {
    if (!enabled() || !indexable(project)) return null;
    const row = await store.getRepo(project.id);
    const leaseActive = row && row.lease_until && new Date(row.lease_until) > new Date();
    if (row && (row.status === 'ready' || row.status === 'behind' || row.status === 'too_large' || leaseActive)) {
      return row;
    }
    // A build that just failed isn't retried on every question.
    if (row && row.status === 'failed' && row.updated_at
        && Date.now() - new Date(row.updated_at).getTime() < FAILED_BACKOFF_MS) {
      return row;
    }
    run(project, { reason: 'ensure' }).catch(() => {});
    return row;
  }

  /** A push webhook for this project. Only the indexed branch counts; no index yet means nothing to do. */
  async function onPush(project, payload) {
    if (!enabled() || !indexable(project) || !payload) return { skipped: 'not_indexable' };
    if (payload.deleted) return { skipped: 'branch_deleted' };
    const branch = typeof payload.ref === 'string' && payload.ref.startsWith('refs/heads/')
      ? payload.ref.slice('refs/heads/'.length) : null;
    const row = await store.getRepo(project.id);
    if (!row) return { skipped: 'no_index' };
    // The indexed branch, or the repo's default branch if that changed.
    const defaultBranch = payload.repository && payload.repository.default_branch;
    if (!branch || (branch !== row.branch && branch !== defaultBranch)) return { skipped: 'other_branch' };
    if (row.status === 'ready' && payload.after && row.indexed_sha === payload.after) return { skipped: 'already_indexed' };
    return run(project, { forcedPush: !!payload.forced, reason: 'push' });
  }

  function rebuild(project) {
    return run(project, { force: true, reason: 'rebuild' });
  }

  /** Nightly: every index that may be behind gets one sync, one project at a time. */
  async function heal({ limit = 2000 } = {}) {
    if (!enabled()) return { checked: 0 };
    const rows = await store.listForHeal({ limit });
    let checked = 0;
    for (const row of rows) {
      if (row.lease_until && new Date(row.lease_until) > new Date()) continue;
      const project = await projects.findById(row.project_id).catch(() => null);
      if (!project) continue;
      checked += 1;
      await run(project, { reason: 'heal' }).catch(() => {});
    }
    log({ action: 'heal', checked });
    return { checked };
  }

  return { ensureBuilt, onPush, rebuild, heal, sync, run, _queues: queues };
}

let defaultIndex = null;
function getCodeIndex() {
  if (!defaultIndex) defaultIndex = createCodeIndex();
  return defaultIndex;
}

module.exports = { createCodeIndex, getCodeIndex, isAccessLoss, storedError, indexable, FULL_BUILDS_PER_DAY };

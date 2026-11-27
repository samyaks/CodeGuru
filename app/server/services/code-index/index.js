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
const { fullBuild } = require('./build');
const { applyPush } = require('./update');

const ACCESS_CODES = new Set(['GITHUB_APP_REQUIRED', 'GITHUB_SIGNIN_REQUIRED']);

/** GitHub says Takeoff can't read the repo any more (not an outage or a rate limit). */
function isAccessLoss(err) {
  if (!err) return false;
  if (err.code && ACCESS_CODES.has(err.code)) return true;
  if (err.installationGone) return true;
  if (err.code === 'FORBIDDEN' && err.statusCode === 403) return true;
  const status = err.status || err.statusCode;
  if (status === 404 || status === 401) return true;
  if (status === 403) return !/rate limit|abuse|secondary/i.test(String(err.message || ''));
  return false;
}

/** A short reason to store, never a raw GitHub response body. */
function storedError(err) {
  if (!err) return 'Unknown error.';
  if (err.code === 'TAR_CORRUPT') return 'The repository download could not be read.';
  const status = err.status || err.statusCode;
  if (status === 403 || status === 429) return 'GitHub is rate-limiting requests; it will be retried.';
  if (status >= 500) return 'GitHub did not respond as expected; it will be retried.';
  if (err.code === 'GITHUB_RATE_LIMITED' || err.code === 'GITHUB_UNAVAILABLE') return String(err.message).slice(0, 200);
  return 'The index could not be updated; it will be retried.';
}

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
   * Bring the index to the branch head. `force` rebuilds from a tarball even
   * when the index is current or was too large.
   */
  async function sync(project, { force = false, forcedPush = false, reason = 'sync' } = {}) {
    if (!enabled()) return { skipped: 'disabled' };
    if (!indexable(project)) return { skipped: 'not_indexable' };
    const projectId = project.id;
    const repoName = projectRepo(project);
    const client = clientFor(project);
    const token = crypto.randomUUID();
    let claimed = false;
    let full = false;

    try {
      const existing = await store.getRepo(projectId);
      if (existing && existing.status === 'too_large' && !force) return { skipped: 'too_large' };

      let branch = project.branch || (existing && existing.repo === repoName ? existing.branch : null);
      if (!branch) {
        const meta = await client.fetchRepoMeta(project.owner, project.repo);
        branch = (meta && meta.default_branch) || 'main';
      }
      const head = await client.fetchBranch(project.owner, project.repo, branch);
      const sha = head && head.commit && head.commit.sha;
      if (!sha) throw Object.assign(new Error('branch has no head commit'), { status: 404 });

      const sameTarget = existing && existing.repo === repoName && existing.branch === branch;
      if (!force && sameTarget && existing.status === 'ready' && existing.indexed_sha === sha) {
        return { status: 'ready', indexedSha: sha, unchanged: true };
      }

      full = force || forcedPush || !sameTarget || !existing.indexed_sha
        || !['ready', 'behind'].includes(existing.status);
      const row = await store.claim(projectId, { repo: repoName, branch, token, full });
      if (!row) {
        if (existing) await store.markBehind(projectId);
        return { skipped: 'busy' };
      }
      claimed = true;

      let result = null;
      if (!full) {
        result = await applyPush({
          projectId, owner: project.owner, repo: project.repo,
          fromSha: existing.indexed_sha, toSha: sha, client, store, token,
        });
        if (result.needFull) {
          log({ projectId, action: 'full_build_needed', reason: result.reason });
          full = true;
          await store.setBuilding(projectId, token);
          result = null;
        }
      }
      if (full) {
        if (!sameTarget) await store.clearFiles(projectId, token);
        result = await fullBuild({
          projectId, owner: project.owner, repo: project.repo, sha, client, store, token, limits,
        });
      }
      await store.release(projectId, token, {
        status: result.status, indexedSha: result.indexedSha, error: result.error || null,
        full, update: !full,
      });
      log({ projectId, action: full ? 'built' : 'updated', reason, status: result.status, sha: sha.slice(0, 12) });
      return { status: result.status, indexedSha: result.indexedSha, full };
    } catch (err) {
      if (err && err.code === 'CODE_INDEX_LEASE_LOST') {
        log({ projectId, action: 'lease_lost', reason });
        return { skipped: 'lease_lost' };
      }
      if (isAccessLoss(err)) {
        await store.deleteForProject(projectId).catch(() => {});
        log({ projectId, action: 'deleted_no_access', reason });
        return { status: 'deleted' };
      }
      log({ projectId, action: 'failed', reason, error: String(err && err.message || err).slice(0, 200) });
      if (claimed) {
        await store.release(projectId, token, { status: 'failed', error: storedError(err), full: false })
          .catch(() => {});
      }
      return { status: 'failed' };
    }
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
    const indexedBranch = project.branch || row.branch;
    if (!branch || branch !== indexedBranch) return { skipped: 'other_branch' };
    if (row.status === 'ready' && payload.after && row.indexed_sha === payload.after) return { skipped: 'already_indexed' };
    return run(project, { forcedPush: !!payload.forced, reason: 'push' });
  }

  function rebuild(project) {
    return run(project, { force: true, reason: 'rebuild' });
  }

  /** Nightly: every index that may be behind gets one sync, one project at a time. */
  async function heal({ limit = 500 } = {}) {
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

module.exports = { createCodeIndex, getCodeIndex, isAccessLoss, storedError, indexable };

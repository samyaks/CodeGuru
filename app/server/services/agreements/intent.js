'use strict';

// The project's current intent, read from takeoff.yaml on the default branch
// through the Takeoff GitHub App: which areas exist and who their Creators
// are. Cached briefly so a page of agreements doesn't call GitHub per row.

const { validateText, migrateData, FILENAME } = require('@takeoff/cli');

const CACHE_MS = 60 * 1000;
const cache = new Map();

function defaultClient(project) {
  const { getGithubApp } = require('../../lib/github-app');
  return getGithubApp().clientForInstallation(Number(project.github_installation_id), { repo: project.repo });
}

/**
 * @returns {Promise<{ ok: boolean, reason: string|null, branch: string|null,
 *   areas: Array<{ id: string, name: string, creators: string[] }> }>}
 */
async function readIntent(project, { clientFor = defaultClient, now = Date.now(), fresh = false } = {}) {
  const key = String(project.id);
  const hit = cache.get(key);
  if (!fresh && hit && now - hit.at < CACHE_MS) return hit.value;

  let value;
  if (!project.github_installation_id || !project.owner || !project.repo) {
    value = { ok: false, reason: 'app_not_installed', branch: null, areas: [] };
  } else {
    try {
      const gh = clientFor(project);
      const meta = await gh.fetchRepoMeta(project.owner, project.repo);
      const branch = meta.default_branch || 'main';
      const text = await gh.fetchFileTextOrNull(project.owner, project.repo, FILENAME, branch);
      if (text === null) {
        value = { ok: false, reason: 'no_takeoff_yaml', branch, areas: [] };
      } else {
        const v = validateText(text);
        let data = v.data;
        if (v.version === 1 && data) data = migrateData(data).data;
        const areas = Array.isArray(data?.areas) ? data.areas : [];
        value = {
          ok: !v.issues.some((i) => i.severity === 'error'),
          reason: v.issues.some((i) => i.severity === 'error') ? 'invalid_takeoff_yaml' : null,
          branch,
          areas: areas
            .filter((a) => a && typeof a.id === 'string')
            .map((a) => ({
              id: a.id,
              name: typeof a.name === 'string' ? a.name : a.id,
              creators: Array.isArray(a.creators) ? a.creators.filter((c) => typeof c === 'string').map((c) => c.toLowerCase()) : [],
            })),
        };
      }
    } catch (err) {
      console.warn('[agreements] reading takeoff.yaml failed:', err.message);
      value = { ok: false, reason: 'github_unavailable', branch: null, areas: [] };
      cache.delete(key);
      return value; // don't cache a failure
    }
  }
  cache.set(key, { at: now, value });
  return value;
}

function forgetIntent(projectId) {
  cache.delete(String(projectId));
}

module.exports = { readIntent, forgetIntent };

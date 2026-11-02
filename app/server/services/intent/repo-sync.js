/**
 * Intent loop V1 — write the active intent into the user's repo (owner: Agent C).
 *
 * Commits two non-code files to slice.branch as the user (their OAuth token):
 *   - .intent/active.json                  (renderActiveIntent)
 *   - the rules file their agent reads     (renderRulesBlock, marker-scoped upsert)
 * Falls back to a branch + PR only when branch protection rejects the commit.
 * Never writes anywhere else; never rewrites content outside the markers.
 *
 * Contract: docs/specs/intent-driven-building.md → Agent C.
 * Throws NeedsReconnectError when the token lacks `repo`.
 */

const { NotImplementedError } = require('../../lib/slice-types');

/**
 * What sync would commit, without writing. The client shows this before the
 * user confirms.
 * @param {{ slice: import('../../lib/slice-types').Slice, project: Object, userToken: string }} args
 * @returns {Promise<{ branch: string, files: Array<{ path: string, action: 'create'|'update', content: string }> }>}
 */
async function previewSync(args) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('repo-sync.previewSync');
}

/**
 * Idempotent: re-running updates the files in place and reuses an open PR.
 * @param {{ slice: import('../../lib/slice-types').Slice, project: Object, userToken: string }} args
 * @returns {Promise<{ mode: 'commit'|'pr', commitSha: string|null, prUrl: string|null, prNumber: number|null, rulesFile: string, branch: string }>}
 */
async function syncSliceToRepo(args) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('repo-sync.syncSliceToRepo');
}

module.exports = { previewSync, syncSliceToRepo };

/**
 * Intent loop V1 — persistence for intent_slices + slice_events (owner: Agent B).
 *
 * Owns its own SQL against getDb(); does not edit lib/db.js. Backed by
 * migration 028_intent_slices.sql. Every function returns a full Slice (see
 * lib/slice-types.js) so routes can hand rows straight to the client.
 *
 * Contract: docs/specs/intent-driven-building.md → Agent B.
 */

const { NotImplementedError } = require('./slice-types');

/**
 * Insert a new slice in status 'active'. Throws AppError.conflict when the
 * project already has a slice in OPEN_SLICE_STATUSES (enforced by the partial
 * unique index as well).
 * @param {{ projectId: string, source: import('./slice-types').SliceSource, derived: import('./slice-types').DerivedSlice, prompt: string, branch: string }} args
 * @returns {Promise<import('./slice-types').Slice>}
 */
async function create(args) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.create');
}

/** @returns {Promise<import('./slice-types').Slice|null>} the open slice (active|verifying) or null */
async function getActive(projectId) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.getActive');
}

/** @returns {Promise<import('./slice-types').Slice|null>} */
async function getById(sliceId) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.getById');
}

/** Last N verified/abandoned slices, newest first. @returns {Promise<import('./slice-types').Slice[]>} */
async function listRecent(projectId, limit = 5) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.listRecent');
}

/**
 * Patch top-level fields (status, sync, staging, branch, verified_at, prompt).
 * @param {string} sliceId
 * @param {Partial<import('./slice-types').Slice>} patch
 * @returns {Promise<import('./slice-types').Slice>}
 */
async function update(sliceId, patch) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.update');
}

/**
 * Set one criterion's verdict. Does not flip met → unmet when verifiedBy is
 * 'verifier'; owners may.
 * @param {string} sliceId
 * @param {string} criterionId
 * @param {{ status: import('./slice-types').CriterionStatus, evidence: string|null, verifiedBy: 'verifier'|'owner' }} verdict
 * @returns {Promise<import('./slice-types').Slice>}
 */
async function setCriterion(sliceId, criterionId, verdict) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.setCriterion');
}

/**
 * Record a push: bumps pushes.last_seen_at, replaces pushes.guardrail_touched,
 * moves active → verifying.
 * @param {string} sliceId
 * @param {{ guardrailTouched: string[], headSha: string|null }} push
 * @returns {Promise<import('./slice-types').Slice>}
 */
async function recordPush(sliceId, push) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.recordPush');
}

/**
 * Append to slice_events. Never throws (logs and returns null on failure) so
 * logging can't break the loop.
 * @param {string} sliceId
 * @param {typeof import('./slice-types').SLICE_EVENT_KINDS[number]} kind
 * @param {Object} [metadata]
 * @returns {Promise<Object|null>}
 */
async function appendEvent(sliceId, kind, metadata = {}) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-store.appendEvent');
}

module.exports = { create, getActive, getById, listRecent, update, setCriterion, recordPush, appendEvent };

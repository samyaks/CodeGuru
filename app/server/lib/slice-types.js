/**
 * Intent loop V1 — shared slice contract.
 *
 * Source of truth: docs/specs/intent-driven-building.md → "Shared contracts".
 * The client mirror is app/client/src/services/sliceApi.ts; keep the two in
 * step. Every intent-loop module (deriver, store, routes, repo-sync, verifier)
 * imports the constants here rather than restating string literals.
 *
 * @typedef {'active' | 'verifying' | 'verified' | 'abandoned'} SliceStatus
 * @typedef {'pending' | 'met' | 'unmet' | 'unknown'} CriterionStatus
 * @typedef {'feature' | 'regression'} CriterionKind
 * @typedef {'next_thing' | 'gap' | 'manual'} SliceSourceKind
 *
 * @typedef {Object} AcceptanceCriterion
 * @property {string} id                       "ac-1"
 * @property {CriterionKind} kind
 * @property {string} description              what a non-engineer checks
 * @property {string} expected_behavior        what they should see
 * @property {CriterionStatus} status
 * @property {string|null} evidence            one line, from the verifier or the owner
 * @property {'verifier'|'owner'|null} verified_by
 * @property {string|null} verified_at
 *
 * @typedef {Object} SliceSource
 * @property {SliceSourceKind} kind
 * @property {string|null} id                  gap id when kind === 'gap'
 * @property {string|null} text                what the owner typed when kind === 'manual'
 *
 * @typedef {Object} SliceSync
 * @property {'commit'|'pr'|null} mode         commit = direct to branch; pr = protection forced a PR
 * @property {string|null} commit_sha
 * @property {string|null} pr_url
 * @property {number|null} pr_number
 * @property {string|null} rules_file          which rules file received the pointer block
 * @property {string|null} synced_at
 *
 * @typedef {Object} SliceStaging
 * @property {boolean} tested
 * @property {string|null} url
 *
 * @typedef {Object} SlicePushes
 * @property {string|null} last_seen_at
 * @property {string[]} guardrail_touched      files that violated protected_paths on the latest push
 *
 * @typedef {Object} Slice
 * @property {string} id
 * @property {string} project_id
 * @property {SliceStatus} status
 * @property {SliceSource} source
 * @property {string} title
 * @property {string} objective
 * @property {string|null} why
 * @property {string[]} existing               "components/Login.tsx — email form, no submit handler"
 * @property {string[]} guardrails
 * @property {string[]} protected_paths        repo-relative globs the agent must not modify
 * @property {AcceptanceCriterion[]} acceptance_criteria
 * @property {string} prompt                   rendered by slice-prompt.js, cached
 * @property {string} branch                   the branch the builder pushes to
 * @property {SliceSync} sync
 * @property {SliceStaging} staging
 * @property {SlicePushes} pushes
 * @property {string} activated_at
 * @property {string|null} verified_at
 *
 * @typedef {Object} DerivedSlice  — what slice-deriver.js returns (no state fields)
 * @property {string} title
 * @property {string} objective
 * @property {string|null} why
 * @property {string[]} existing
 * @property {string[]} guardrails
 * @property {string[]} protected_paths
 * @property {Array<Pick<AcceptanceCriterion, 'id'|'kind'|'description'|'expected_behavior'>>} acceptance_criteria
 */

const { AppError } = require('./app-error');

const SLICE_STATUSES = Object.freeze(['active', 'verifying', 'verified', 'abandoned']);
const CRITERION_STATUSES = Object.freeze(['pending', 'met', 'unmet', 'unknown']);
const CRITERION_KINDS = Object.freeze(['feature', 'regression']);
const SLICE_SOURCE_KINDS = Object.freeze(['next_thing', 'gap', 'manual']);
const SYNC_MODES = Object.freeze(['commit', 'pr']);

/** Slice statuses that count as "one is active" for the 409 rule. */
const OPEN_SLICE_STATUSES = Object.freeze(['active', 'verifying']);

/** slice_events.kind values (the verification log). */
const SLICE_EVENT_KINDS = Object.freeze([
  'activated',
  'prompt_copied',
  'synced',
  'push_seen',
  'guardrail_touched',
  'criterion_verdict',
  'criterion_override',
  'verified',
  'abandoned',
]);

/** Owners may set these by hand; 'unknown' is verifier-only. */
const OWNER_SETTABLE_CRITERION_STATUSES = Object.freeze(['met', 'unmet', 'pending']);

/** Limits the deriver enforces (spec → Agent A). */
const SLICE_LIMITS = Object.freeze({
  existing: { min: 1, max: 6 },
  guardrails: { min: 3, max: 6 },
  protected_paths: { min: 0, max: 8 },
  acceptance_criteria: { min: 2, max: 5 },
  manualTextMax: 500,
});

/** Files repo-sync writes; the verifier ignores these in protected-path checks. */
const INTENT_FILE_PATH = '.intent/active.json';
const INTENT_SCHEMA_URL = 'https://takeoff.dev/schemas/active-intent-v1.json';
const RULES_BLOCK_START = '<!-- takeoff:intent -->';
const RULES_BLOCK_END = '<!-- /takeoff:intent -->';

/** Detection order for the rules-file pointer block (first match wins). */
const RULES_FILE_CANDIDATES = Object.freeze([
  { when: '.cursor/rules/', write: '.cursor/rules/takeoff-intent.mdc', mode: 'whole' },
  { when: 'CLAUDE.md', write: 'CLAUDE.md', mode: 'block' },
  { when: 'AGENTS.md', write: 'AGENTS.md', mode: 'block' },
]);
const RULES_FILE_DEFAULT = 'AGENTS.md';

/** Thrown by Agent 0 stubs; replaced module-by-module as A–E land. */
class NotImplementedError extends AppError {
  constructor(what) {
    super(`${what} is not implemented yet (intent loop V1 stub)`, 501, 'NOT_IMPLEMENTED');
  }
}

/**
 * Thrown by repo-sync when the user's token lacks `repo`. The global error
 * handler turns it into 424 { error, code: 'NEEDS_RECONNECT' }; the client
 * treats that code as "send the user through /auth/github/reconnect".
 */
class NeedsReconnectError extends AppError {
  constructor(message = 'GitHub access needs to be reconnected with repo permission') {
    super(message, 424, 'NEEDS_RECONNECT');
    this.needsReconnect = true;
  }
}

/** Empty state objects, so every row has the same JSONB shape. */
function emptySync() {
  return { mode: null, commit_sha: null, pr_url: null, pr_number: null, rules_file: null, synced_at: null };
}
function emptyStaging() {
  return { tested: false, url: null };
}
function emptyPushes() {
  return { last_seen_at: null, guardrail_touched: [] };
}

module.exports = {
  SLICE_STATUSES,
  CRITERION_STATUSES,
  CRITERION_KINDS,
  SLICE_SOURCE_KINDS,
  SYNC_MODES,
  OPEN_SLICE_STATUSES,
  SLICE_EVENT_KINDS,
  OWNER_SETTABLE_CRITERION_STATUSES,
  SLICE_LIMITS,
  INTENT_FILE_PATH,
  INTENT_SCHEMA_URL,
  RULES_BLOCK_START,
  RULES_BLOCK_END,
  RULES_FILE_CANDIDATES,
  RULES_FILE_DEFAULT,
  NotImplementedError,
  NeedsReconnectError,
  emptySync,
  emptyStaging,
  emptyPushes,
};

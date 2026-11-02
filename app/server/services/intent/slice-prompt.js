/**
 * Intent loop V1 — prompt + file renderers (owner: Agent A).
 *
 * Pure functions, no I/O. The template lives in
 * docs/specs/intent-driven-building.md → "Prompt template"; the exact words
 * matter because coding agents read them.
 */

const {
  NotImplementedError,
  INTENT_SCHEMA_URL,
  RULES_BLOCK_START,
  RULES_BLOCK_END,
} = require('../../lib/slice-types');

/**
 * The text behind "Copy prompt".
 * @param {import('../../lib/slice-types').Slice} slice
 * @param {{ repoLabel: string, branch: string }} ctx   repoLabel = "owner/repo"
 * @returns {string}
 */
function renderPrompt(slice, ctx) { // eslint-disable-line no-unused-vars
  throw new NotImplementedError('slice-prompt.renderPrompt');
}

/**
 * The object written to .intent/active.json. No state fields (status,
 * evidence, sync); the repo holds the spec, Takeoff holds the state.
 * @param {import('../../lib/slice-types').Slice} slice
 * @returns {Object}
 */
function renderActiveIntent(slice) {
  return {
    $schema: INTENT_SCHEMA_URL,
    intent_id: slice.id,
    feature_title: slice.title,
    current_micro_slice: { slice_id: slice.id, name: slice.title, objective: slice.objective },
    existing: slice.existing || [],
    guardrails: slice.guardrails || [],
    protected_paths: slice.protected_paths || [],
    acceptance_criteria: (slice.acceptance_criteria || []).map((c) => ({
      id: c.id,
      kind: c.kind,
      description: c.description,
      expected_behavior: c.expected_behavior,
    })),
    generated_by: 'takeoff',
    generated_at: new Date().toISOString(),
  };
}

/**
 * The marker-delimited block repo-sync upserts into CLAUDE.md / AGENTS.md, or
 * writes whole into .cursor/rules/takeoff-intent.mdc (with frontmatter added
 * by repo-sync).
 * @returns {string}
 */
function renderRulesBlock() {
  return [
    RULES_BLOCK_START,
    '## Current intent (managed by Takeoff)',
    'Before changing code, read `.intent/active.json`. Build only `current_micro_slice`.',
    'Do not modify any path listed under `protected_paths`. Treat `guardrails` as hard rules.',
    RULES_BLOCK_END,
  ].join('\n');
}

module.exports = { renderPrompt, renderActiveIntent, renderRulesBlock };

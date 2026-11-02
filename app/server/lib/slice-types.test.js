const test = require('node:test');
const assert = require('node:assert/strict');

const types = require('./slice-types');
const { AppError } = require('./app-error');
const { renderActiveIntent, renderRulesBlock } = require('../services/intent/slice-prompt');
const { parseActivateBody, parseCriterionBody, parseStagingBody } = require('../routes/v2/slice');

test('NotImplementedError / NeedsReconnectError are AppErrors with the agreed codes', () => {
  const ni = new types.NotImplementedError('x');
  assert.ok(ni instanceof AppError);
  assert.equal(ni.statusCode, 501);
  assert.equal(ni.code, 'NOT_IMPLEMENTED');

  const nr = new types.NeedsReconnectError();
  assert.ok(nr instanceof AppError);
  assert.equal(nr.statusCode, 424);
  assert.equal(nr.code, 'NEEDS_RECONNECT');
  assert.equal(nr.needsReconnect, true);
});

test('open statuses are a subset of slice statuses; owner-settable excludes unknown', () => {
  for (const s of types.OPEN_SLICE_STATUSES) assert.ok(types.SLICE_STATUSES.includes(s));
  assert.ok(!types.OWNER_SETTABLE_CRITERION_STATUSES.includes('unknown'));
  for (const s of types.OWNER_SETTABLE_CRITERION_STATUSES) assert.ok(types.CRITERION_STATUSES.includes(s));
});

test('renderActiveIntent writes the spec, not the state', () => {
  const slice = {
    id: 'sl_1',
    title: 'A way to tell its people apart',
    objective: 'Finish email sign-in.',
    existing: ['components/Login.tsx — email form, no submit handler'],
    guardrails: ['Use the existing Supabase client in lib/db.ts'],
    protected_paths: ['app/checkout/**'],
    acceptance_criteria: [
      { id: 'ac-1', kind: 'feature', description: 'd', expected_behavior: 'e', status: 'met', evidence: 'x', verified_by: 'owner', verified_at: 'now' },
    ],
    status: 'verifying',
    sync: { mode: 'commit' },
  };
  const out = renderActiveIntent(slice);
  assert.equal(out.$schema, types.INTENT_SCHEMA_URL);
  assert.equal(out.intent_id, 'sl_1');
  assert.deepEqual(out.current_micro_slice, { slice_id: 'sl_1', name: slice.title, objective: slice.objective });
  assert.deepEqual(out.acceptance_criteria, [{ id: 'ac-1', kind: 'feature', description: 'd', expected_behavior: 'e' }]);
  assert.equal(out.generated_by, 'takeoff');
  assert.ok(!('status' in out));
  assert.ok(!('sync' in out));
  assert.ok(!('evidence' in out.acceptance_criteria[0]));
});

test('renderRulesBlock is marker-delimited and points at the intent file', () => {
  const block = renderRulesBlock();
  assert.ok(block.startsWith(types.RULES_BLOCK_START));
  assert.ok(block.endsWith(types.RULES_BLOCK_END));
  assert.ok(block.includes(types.INTENT_FILE_PATH));
  assert.ok(block.includes('protected_paths'));
});

test('parseActivateBody accepts the three sources and rejects the rest', () => {
  assert.deepEqual(parseActivateBody({ source: 'next_thing' }), { kind: 'next_thing', id: null, text: null });
  assert.deepEqual(parseActivateBody({ source: 'gap', gapId: ' g1 ' }), { kind: 'gap', id: 'g1', text: null });
  assert.deepEqual(parseActivateBody({ source: 'manual', text: ' fix login ' }), { kind: 'manual', id: null, text: 'fix login' });
  assert.throws(() => parseActivateBody({}), /source must be one of/);
  assert.throws(() => parseActivateBody({ source: 'gap' }), /gapId is required/);
  assert.throws(() => parseActivateBody({ source: 'manual', text: '   ' }), /text is required/);
  assert.throws(() => parseActivateBody({ source: 'manual', text: 'x'.repeat(types.SLICE_LIMITS.manualTextMax + 1) }), /characters or fewer/);
});

test('parseCriterionBody allows only owner-settable statuses', () => {
  assert.deepEqual(parseCriterionBody({ status: 'met' }), { status: 'met', note: null });
  assert.deepEqual(parseCriterionBody({ status: 'unmet', note: ' broke ' }), { status: 'unmet', note: 'broke' });
  assert.throws(() => parseCriterionBody({ status: 'unknown' }), /status must be one of/);
  assert.throws(() => parseCriterionBody(null), /status must be one of/);
});

test('parseStagingBody validates the toggle and optional http(s) URL', () => {
  assert.deepEqual(parseStagingBody({ tested: true }), { tested: true, url: null });
  assert.deepEqual(parseStagingBody({ tested: false, url: '' }), { tested: false, url: null });
  assert.equal(parseStagingBody({ tested: true, url: 'https://app.example.com/x' }).url, 'https://app.example.com/x');
  assert.throws(() => parseStagingBody({ tested: 'yes' }), /tested must be a boolean/);
  assert.throws(() => parseStagingBody({ tested: true, url: 'ftp://x' }), /http\(s\)/);
  assert.throws(() => parseStagingBody({ tested: true, url: 'not a url' }), /http\(s\)/);
});

const { test } = require('node:test');
const assert = require('node:assert');

// Pure tests: resolveCorrectionText needs nothing, and applyCorrection takes
// injected deps — no DB, no LLM, no Express.
const { resolveCorrectionText, applyCorrection } = require('./cascade');

const CLAIM_WITH_ALTERNATIVE = {
  id: 'claim-2',
  slot: 'audience',
  text: 'someone improving on their own',
  alternative: {
    question: "Who's this really for?",
    options: [
      { id: 'solo', label: 'Someone on their own', detail: 'Private habits.', claimText: 'someone improving on their own' },
      { id: 'shared', label: 'People keeping each other honest', detail: 'Partners share streaks.', claimText: 'people keeping each other honest' },
    ],
  },
};

const CLAIM_WITHOUT_ALTERNATIVE = {
  id: 'claim-1',
  slot: 'objective',
  text: 'helps people build lasting habits',
  alternative: null,
};

function assertBadRequest(fn, messagePattern) {
  assert.throws(fn, (err) => {
    assert.strictEqual(err.code, 'BAD_REQUEST');
    if (messagePattern) assert.match(err.message, messagePattern);
    return true;
  });
}

// ── resolveCorrectionText ──────────────────────────────────────────

test('free text: happy path, trimmed', () => {
  const out = resolveCorrectionText(CLAIM_WITHOUT_ALTERNATIVE, { text: '  helps two people stay honest  ' });
  assert.deepStrictEqual(out, { text: 'helps two people stay honest' });
});

test('free text: empty and whitespace-only rejected as BAD_REQUEST', () => {
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITHOUT_ALTERNATIVE, { text: '' }), /`text`/);
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITHOUT_ALTERNATIVE, { text: '   \n\t ' }), /`text`/);
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITHOUT_ALTERNATIVE, { text: 42 }), /`text`/);
});

test('optionId: resolves to the matching option claimText', () => {
  const out = resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, { optionId: 'shared' });
  assert.deepStrictEqual(out, { text: 'people keeping each other honest' });
});

test('optionId: unknown id rejected as BAD_REQUEST', () => {
  assertBadRequest(
    () => resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, { optionId: 'nope' }),
    /does not match any option/
  );
});

test('optionId: claim without an alternative rejected as BAD_REQUEST', () => {
  assertBadRequest(
    () => resolveCorrectionText(CLAIM_WITHOUT_ALTERNATIVE, { optionId: 'solo' }),
    /does not match any option/
  );
});

test('optionId: malformed values rejected as BAD_REQUEST', () => {
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, { optionId: '' }), /non-empty string/);
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, { optionId: 7 }), /non-empty string/);
  // An option whose claimText is missing can't settle anything.
  const broken = { ...CLAIM_WITH_ALTERNATIVE, alternative: { question: 'q', options: [{ id: 'x', label: 'X' }] } };
  assertBadRequest(() => resolveCorrectionText(broken, { optionId: 'x' }), /does not match any option/);
});

test('both text and optionId provided: optionId wins', () => {
  const out = resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, { text: 'my own words', optionId: 'solo' });
  assert.deepStrictEqual(out, { text: 'someone improving on their own' });
});

test('neither text nor optionId: rejected as BAD_REQUEST', () => {
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, {}), /Provide `text`/);
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, null), /Provide `text`/);
  assertBadRequest(() => resolveCorrectionText(CLAIM_WITH_ALTERNATIVE, undefined), /Provide `text`/);
});

// ── applyCorrection (injected fake deps) ───────────────────────────

function makeDeps({ claim = CLAIM_WITH_ALTERNATIVE, settleReturns, rederiveError } = {}) {
  const calls = { findById: [], settle: [], rederiveNext: [] };
  const deps = {
    readClaims: {
      async findById(id, projectId) {
        calls.findById.push({ id, projectId });
        return claim;
      },
      async settle(id, projectId, { text }) {
        calls.settle.push({ id, projectId, text });
        if (settleReturns !== undefined) return settleReturns;
        return { ...claim, text, status: 'settled', source: 'human' };
      },
    },
    async rederiveNext(projectId) {
      calls.rederiveNext.push(projectId);
      if (rederiveError) throw rederiveError;
      return { title: 't', why: 'w', prompt: 'p', category: 'auth' };
    },
  };
  return { deps, calls };
}

test('applyCorrection: settles with the resolved text and re-derives the next-thing', async () => {
  const { deps, calls } = makeDeps();

  const result = await applyCorrection('proj-1', 'claim-2', { optionId: 'shared' }, deps);

  assert.deepStrictEqual(calls.findById, [{ id: 'claim-2', projectId: 'proj-1' }]);
  assert.deepStrictEqual(calls.settle, [{ id: 'claim-2', projectId: 'proj-1', text: 'people keeping each other honest' }]);
  assert.deepStrictEqual(calls.rederiveNext, ['proj-1']);

  assert.strictEqual(result.nextStale, false);
  assert.strictEqual(result.claim.status, 'settled');
  assert.strictEqual(result.claim.source, 'human');
  assert.strictEqual(result.claim.text, 'people keeping each other honest');
});

test('applyCorrection: free text is trimmed before the settle', async () => {
  const { deps, calls } = makeDeps();

  await applyCorrection('proj-1', 'claim-2', { text: '  people keeping each other honest  ' }, deps);
  assert.strictEqual(calls.settle[0].text, 'people keeping each other honest');
});

test('applyCorrection: missing claim throws NOT_FOUND before any settle', async () => {
  const { deps, calls } = makeDeps({ claim: null });

  await assert.rejects(
    () => applyCorrection('proj-1', 'claim-x', { text: 'hi' }, deps),
    (err) => {
      assert.strictEqual(err.code, 'NOT_FOUND');
      return true;
    }
  );
  assert.strictEqual(calls.settle.length, 0);
  assert.strictEqual(calls.rederiveNext.length, 0);
});

test('applyCorrection: settle returning null throws NOT_FOUND, no re-derivation', async () => {
  const { deps, calls } = makeDeps({ settleReturns: null });

  await assert.rejects(
    () => applyCorrection('proj-1', 'claim-2', { text: 'hi' }, deps),
    (err) => {
      assert.strictEqual(err.code, 'NOT_FOUND');
      return true;
    }
  );
  assert.strictEqual(calls.rederiveNext.length, 0);
});

test('applyCorrection: bad body throws BAD_REQUEST, nothing settled', async () => {
  const { deps, calls } = makeDeps();

  await assert.rejects(
    () => applyCorrection('proj-1', 'claim-2', {}, deps),
    (err) => {
      assert.strictEqual(err.code, 'BAD_REQUEST');
      return true;
    }
  );
  assert.strictEqual(calls.settle.length, 0);
  assert.strictEqual(calls.rederiveNext.length, 0);
});

test('applyCorrection: rederiveNext failure never undoes the settle — nextStale: true', async () => {
  const { deps, calls } = makeDeps({ rederiveError: new Error('Claude is down') });

  const result = await applyCorrection('proj-1', 'claim-2', { optionId: 'solo' }, deps);

  assert.strictEqual(calls.settle.length, 1);
  assert.strictEqual(result.nextStale, true);
  // The settled claim still comes back — the human decision is durable.
  assert.strictEqual(result.claim.status, 'settled');
  assert.strictEqual(result.claim.text, 'someone improving on their own');
});

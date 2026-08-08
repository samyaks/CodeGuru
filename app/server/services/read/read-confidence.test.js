const { test } = require('node:test');
const assert = require('node:assert');

const { verifyEvidence, scoreClaimConfidence, UNCERTAIN_THRESHOLD } = require('./read-confidence');

const KNOWN_PATHS = [
  'src/Habit.js',
  'src/streak.js',
  'src/components/QuickLog.tsx',
  'app/server/streak.js',
];

// ── verifyEvidence ────────────────────────────────────────────────

test('exact path match verifies', () => {
  const out = verifyEvidence(
    [{ filePath: 'src/Habit.js', symbol: 'logCheckin', note: 'Read plainly.' }],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].verified, true);
  // original fields survive
  assert.strictEqual(out[0].symbol, 'logCheckin');
  assert.strictEqual(out[0].note, 'Read plainly.');
});

test('basename-style citation verifies via suffix match (knownPath ends with /filePath)', () => {
  const out = verifyEvidence(
    [{ filePath: 'QuickLog.tsx', symbol: null, note: 'Cited by basename.' }],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(out[0].verified, true);
});

test('a longer citation whose suffix is a known path verifies (filePath ends with /knownPath)', () => {
  const out = verifyEvidence(
    [{ filePath: 'repo-root/src/Habit.js', symbol: null, note: 'Over-qualified path.' }],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(out[0].verified, true);
});

test('a bare basename matching MULTIPLE known paths still verifies', () => {
  // streak.js matches both src/streak.js and app/server/streak.js
  const out = verifyEvidence(
    [{ filePath: 'streak.js', symbol: null, note: 'Ambiguous but real.' }],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(out[0].verified, true);
});

test('partial-basename overlap does NOT verify (no substring matching)', () => {
  // "abit.js" is a substring of Habit.js but not a path-boundary suffix
  const out = verifyEvidence(
    [{ filePath: 'abit.js', symbol: null, note: 'Substring trap.' }],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(out[0].verified, false);
});

test('made-up paths are unverified', () => {
  const out = verifyEvidence(
    [{ filePath: 'src/DoesNotExist.js', symbol: null, note: 'Hallucinated.' }],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(out[0].verified, false);
});

test('filePath=null is never verified', () => {
  const out = verifyEvidence(
    [{ filePath: null, symbol: null, note: 'Pure inference.' }],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(out[0].verified, false);
});

test('empty knownPaths verifies nothing — concrete paths alone are no longer trusted', () => {
  const out = verifyEvidence(
    [{ filePath: 'app/index.js', symbol: null, note: 'Sounds plausible.' }],
    { knownPaths: [] }
  );
  assert.strictEqual(out[0].verified, false);
});

test('invariant link paths count as known (both filePath and file_path keys)', () => {
  const out = verifyEvidence(
    [
      { filePath: 'src/auth.js', symbol: 'login', note: 'From invariant link.' },
      { filePath: 'src/billing.js', symbol: null, note: 'Snake-case link key.' },
    ],
    {
      knownPaths: [],
      invariantLinks: [
        { filePath: 'src/auth.js', symbol: 'login' },
        { file_path: 'src/billing.js', symbol: 'charge' },
      ],
    }
  );
  assert.strictEqual(out[0].verified, true);
  assert.strictEqual(out[1].verified, true);
});

test('leading ./ is normalized on both sides', () => {
  const out = verifyEvidence(
    [{ filePath: './src/Habit.js', symbol: null, note: 'Relative style.' }],
    { knownPaths: ['./src/Habit.js'] }
  );
  assert.strictEqual(out[0].verified, true);
});

test('non-array evidence and missing ctx fields are handled', () => {
  assert.deepStrictEqual(verifyEvidence(null, { knownPaths: KNOWN_PATHS }), []);
  const out = verifyEvidence([{ filePath: 'src/Habit.js', symbol: null, note: 'n' }], {});
  assert.strictEqual(out[0].verified, false);
});

// ── scoreClaimConfidence ──────────────────────────────────────────

test('two verified entries score 0.9', () => {
  const score = scoreClaimConfidence({
    slot: 'core_job',
    evidence: [
      { filePath: 'src/Habit.js', verified: true },
      { filePath: 'src/streak.js', verified: true },
    ],
  });
  assert.strictEqual(score, 0.9);
  assert.ok(score >= UNCERTAIN_THRESHOLD);
});

test('exactly one verified entry scores 0.72', () => {
  const score = scoreClaimConfidence({
    slot: 'objective',
    evidence: [
      { filePath: 'src/Habit.js', verified: true },
      { filePath: 'src/Fake.js', verified: false },
    ],
  });
  assert.strictEqual(score, 0.72);
  assert.ok(score >= UNCERTAIN_THRESHOLD);
});

test('audience claim with entries but zero verified lands in the yellow zone (0.4)', () => {
  const score = scoreClaimConfidence({
    slot: 'audience',
    evidence: [{ filePath: null, verified: false, note: "Absence isn't proof." }],
  });
  assert.strictEqual(score, 0.4);
  assert.ok(score < UNCERTAIN_THRESHOLD);
});

test('non-audience claim with zero verified scores 0.3', () => {
  const score = scoreClaimConfidence({
    slot: 'objective',
    evidence: [{ filePath: 'src/Fake.js', verified: false }],
  });
  assert.strictEqual(score, 0.3);
});

test('audience claim with NO entries at all scores 0.3, not 0.4', () => {
  const score = scoreClaimConfidence({ slot: 'audience', evidence: [] });
  assert.strictEqual(score, 0.3);
});

test('entries without a verified flag are not counted as verified', () => {
  const score = scoreClaimConfidence({
    slot: 'core_job',
    evidence: [{ filePath: 'src/Habit.js' }, { filePath: 'src/streak.js' }],
  });
  assert.strictEqual(score, 0.3);
});

test('verifyEvidence output feeds scoreClaimConfidence end to end', () => {
  const evidence = verifyEvidence(
    [
      { filePath: 'src/Habit.js', symbol: null, note: 'real' },
      { filePath: 'streak.js', symbol: null, note: 'basename' },
      { filePath: 'src/Nope.js', symbol: null, note: 'fake' },
    ],
    { knownPaths: KNOWN_PATHS }
  );
  assert.strictEqual(scoreClaimConfidence({ slot: 'core_job', evidence }), 0.9);
});

test('UNCERTAIN_THRESHOLD is 0.6', () => {
  assert.strictEqual(UNCERTAIN_THRESHOLD, 0.6);
});

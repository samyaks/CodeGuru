const { test } = require('node:test');
const assert = require('node:assert');

const { scoreClaimConfidence, knownFilePaths, UNCERTAIN_THRESHOLD } = require('./read-confidence');

const INVARIANTS = [
  {
    text: 'A check-in is logged in under ten seconds',
    kind: 'behavior',
    confidence: 0.9,
    satisfied: true,
    links: [
      { file_path: 'src/Habit.js', symbol: 'logCheckin' },
      { file_path: 'src/streak.js', symbol: 'updateStreak' },
    ],
  },
];

const MAP = {
  domain: 'Habit tracking',
  personas: [{ id: 'persona:0', name: 'Solo improver', emoji: '🌱', priority: 'high' }],
  jobs: [{ id: 'job:0', persona_id: 'persona:0', title: 'Log a habit fast', priority: 'high' }],
  entities: [{ id: 'e1', type: 'page', label: 'QuickLog', file_path: 'src/QuickLog.tsx' }],
  edges: [],
};

test('two file-grounded evidence entries score high (~0.85)', () => {
  const score = scoreClaimConfidence({
    slot: 'core_job',
    evidence: [
      { filePath: 'src/Habit.js', symbol: 'logCheckin', note: 'Read plainly from Habit.js.' },
      { filePath: 'src/streak.js', symbol: 'updateStreak', note: 'And from streak.js.' },
    ],
    map: MAP,
    invariants: INVARIANTS,
  });
  assert.strictEqual(score, 0.85);
  assert.ok(score >= UNCERTAIN_THRESHOLD);
});

test('one file-grounded evidence entry scores ~0.7', () => {
  const score = scoreClaimConfidence({
    slot: 'objective',
    evidence: [{ filePath: 'src/Habit.js', symbol: null, note: 'Read from Habit.js.' }],
    map: MAP,
    invariants: INVARIANTS,
  });
  assert.strictEqual(score, 0.7);
  assert.ok(score >= UNCERTAIN_THRESHOLD);
});

test('map-entity file paths count as grounding too', () => {
  const score = scoreClaimConfidence({
    slot: 'audience',
    evidence: [{ filePath: 'src/QuickLog.tsx', symbol: null, note: 'The page the persona lives in.' }],
    map: MAP,
    invariants: [],
  });
  assert.strictEqual(score, 0.7);
});

test('audience claim with only inferred (file-less) evidence lands in the yellow zone (0.4)', () => {
  const score = scoreClaimConfidence({
    slot: 'audience',
    evidence: [
      { filePath: null, symbol: null, note: "Nothing in the data model shares between users — but absence isn't proof." },
    ],
    map: MAP,
    invariants: INVARIANTS,
  });
  assert.strictEqual(score, 0.4);
  assert.ok(score < UNCERTAIN_THRESHOLD);
});

test('a made-up file path that matches no known source is not grounding', () => {
  const score = scoreClaimConfidence({
    slot: 'audience',
    evidence: [{ filePath: 'src/DoesNotExist.js', symbol: null, note: 'Hallucinated.' }],
    map: MAP,
    invariants: INVARIANTS,
  });
  assert.strictEqual(score, 0.4);
});

test('nothing grounded at all scores 0.3', () => {
  const score = scoreClaimConfidence({
    slot: 'objective',
    evidence: [],
    map: null,
    invariants: [],
  });
  assert.strictEqual(score, 0.3);
});

test('with no verifiable sources at all, a concrete path still counts', () => {
  const score = scoreClaimConfidence({
    slot: 'objective',
    evidence: [{ filePath: 'app/index.js', symbol: null, note: 'Best available anchor.' }],
    map: null,
    invariants: [],
  });
  assert.strictEqual(score, 0.7);
});

test('knownFilePaths merges invariant links and map entities', () => {
  const known = knownFilePaths({ map: MAP, invariants: INVARIANTS });
  assert.ok(known.has('src/Habit.js'));
  assert.ok(known.has('src/streak.js'));
  assert.ok(known.has('src/QuickLog.tsx'));
  assert.strictEqual(known.size, 3);
});

test('UNCERTAIN_THRESHOLD is 0.6', () => {
  assert.strictEqual(UNCERTAIN_THRESHOLD, 0.6);
});

const { test } = require('node:test');
const assert = require('node:assert');

// Pure-function tests — no DB, no LLM.
const { pickCoreJob } = require('./pick-core-job');

const MAP = {
  personas: [
    { id: 'persona:0', name: 'Habit builder', emoji: '🌱' },
    { id: 'persona:1', name: 'Accountability partner', emoji: '🤝' },
  ],
  jobs: [
    { id: 'job:0', persona_id: 'persona:0', title: 'Log a habit fast', priority: 'high' },
    { id: 'job:1', persona_id: 'persona:1', title: 'Share a streak', priority: 'medium' },
    { id: 'job:2', persona_id: 'persona:0', title: 'Review progress', priority: 'low' },
  ],
  entities: [],
  edges: [],
};

function inv(overrides = {}) {
  return {
    id: 'stmt-a',
    text: 'A check-in is logged in under ten seconds',
    kind: 'behavior',
    scope: 'job',
    confidence: 0.8,
    satisfied: true,
    links: [{ file_path: 'src/Habit.js', symbol: 'logCheckin' }],
    group_label: 'Log a habit fast',
    feature_area: 'Log a habit fast',
    ...overrides,
  };
}

// ── empty / null inputs ─────────────────────────────────────────────

test('returns null when invariants are missing, empty, or not job-scoped', () => {
  assert.strictEqual(pickCoreJob({ map: MAP, invariants: [] }), null);
  assert.strictEqual(pickCoreJob({ map: MAP, invariants: null }), null);
  assert.strictEqual(pickCoreJob({}), null);
  assert.strictEqual(
    pickCoreJob({ map: MAP, invariants: [inv({ scope: 'global' })] }),
    null
  );
});

test('null map: still picks, job and personaName are null', () => {
  const out = pickCoreJob({ map: null, invariants: [inv()] });
  assert.ok(out);
  assert.strictEqual(out.invariant.id, 'stmt-a');
  assert.strictEqual(out.job, null);
  assert.strictEqual(out.personaName, null);
  assert.match(out.reason, /no resolvable map job/);
});

// ── broken-invariant exclusion + all-broken fallback ────────────────

test('satisfied === false is excluded when a holding candidate exists', () => {
  const broken = inv({ id: 'stmt-b', text: 'Broken but confident', confidence: 0.99, satisfied: false });
  const holding = inv({ id: 'stmt-a', confidence: 0.5 });
  const out = pickCoreJob({ map: MAP, invariants: [broken, holding] });
  assert.strictEqual(out.invariant.id, 'stmt-a');
  assert.doesNotMatch(out.reason, /broken/);
});

test('all broken: picks the strongest anyway and says so in reason', () => {
  const weaker = inv({ id: 'stmt-a', confidence: 0.4, satisfied: false });
  const stronger = inv({ id: 'stmt-b', text: 'Stronger broken guarantee', confidence: 0.9, satisfied: false });
  const out = pickCoreJob({ map: MAP, invariants: [weaker, stronger] });
  assert.strictEqual(out.invariant.id, 'stmt-b');
  assert.match(out.reason, /broken/);
  assert.match(out.reason, /strongest/);
});

// ── tiebreaks ────────────────────────────────────────────────────────

test('confidence DESC wins first', () => {
  const low = inv({ id: 'stmt-a', confidence: 0.3 });
  const high = inv({ id: 'stmt-b', confidence: 0.9 });
  const out = pickCoreJob({ map: MAP, invariants: [low, high] });
  assert.strictEqual(out.invariant.id, 'stmt-b');
});

test('numeric-string confidence (pg numeric) is coerced', () => {
  const low = inv({ id: 'stmt-a', confidence: '0.30' });
  const high = inv({ id: 'stmt-b', confidence: '0.90' });
  const out = pickCoreJob({ map: MAP, invariants: [low, high] });
  assert.strictEqual(out.invariant.id, 'stmt-b');
});

test('equal confidence: higher linked-job priority wins (high > medium > low)', () => {
  const onMedium = inv({
    id: 'stmt-a', confidence: 0.7,
    group_label: 'Share a streak', feature_area: 'Share a streak',
  });
  const onHigh = inv({
    id: 'stmt-b', confidence: 0.7,
    group_label: 'Log a habit fast', feature_area: 'Log a habit fast',
  });
  const out = pickCoreJob({ map: MAP, invariants: [onMedium, onHigh] });
  assert.strictEqual(out.invariant.id, 'stmt-b');
  assert.strictEqual(out.job.id, 'job:0');
});

test('equal confidence + priority: more links wins', () => {
  const oneLink = inv({ id: 'stmt-a', confidence: 0.7 });
  const twoLinks = inv({
    id: 'stmt-b', confidence: 0.7,
    links: [
      { file_path: 'src/Habit.js', symbol: 'logCheckin' },
      { file_path: 'src/QuickLog.tsx', symbol: null },
    ],
  });
  const out = pickCoreJob({ map: MAP, invariants: [oneLink, twoLinks] });
  assert.strictEqual(out.invariant.id, 'stmt-b');
});

test('full tie: stable by id — input order does not matter', () => {
  const a = inv({ id: 'stmt-a' });
  const b = inv({ id: 'stmt-b' });
  const out1 = pickCoreJob({ map: MAP, invariants: [a, b] });
  const out2 = pickCoreJob({ map: MAP, invariants: [b, a] });
  assert.strictEqual(out1.invariant.id, 'stmt-a');
  assert.strictEqual(out2.invariant.id, 'stmt-a');
});

// ── job resolution ───────────────────────────────────────────────────

test('resolves job from explicit job_ids attached by the caller', () => {
  const row = inv({ job_ids: ['job:1'], group_label: null, feature_area: null });
  const out = pickCoreJob({ map: MAP, invariants: [row] });
  assert.strictEqual(out.job.id, 'job:1');
  assert.strictEqual(out.personaName, 'Accountability partner');
});

test('resolves job from _jobId (in-memory pre-persist shape)', () => {
  const row = inv({ _jobId: 'job:2', group_label: null, feature_area: null });
  const out = pickCoreJob({ map: MAP, invariants: [row] });
  assert.strictEqual(out.job.id, 'job:2');
});

test('falls back to group_label/feature_area == job title (case-insensitive)', () => {
  const row = inv({ group_label: '  LOG A HABIT FAST ', feature_area: null });
  const out = pickCoreJob({ map: MAP, invariants: [row] });
  assert.strictEqual(out.job.id, 'job:0');
  assert.strictEqual(out.personaName, 'Habit builder');
  assert.match(out.reason, /Log a habit fast/);
});

test('multiple linked jobs: surfaces the highest-priority one', () => {
  const row = inv({ job_ids: ['job:2', 'job:0'], group_label: null, feature_area: null });
  const out = pickCoreJob({ map: MAP, invariants: [row] });
  assert.strictEqual(out.job.id, 'job:0');
});

test('unresolvable association: job is null but the pick still returns', () => {
  const row = inv({ group_label: 'No such job', feature_area: 'No such job' });
  const out = pickCoreJob({ map: MAP, invariants: [row] });
  assert.ok(out);
  assert.strictEqual(out.job, null);
  assert.strictEqual(out.personaName, null);
});

const { test } = require('node:test');
const assert = require('node:assert');

const { toStatement, groupByArea } = require('./intent-mapper');

function row(overrides = {}) {
  return {
    id: 'st-1',
    project_id: 'proj-1',
    text: 'Users can log in',
    kind: 'behavior',
    status: 'candidate',
    source: 'inferred',
    feature_area: 'auth',
    links: [
      { file_path: 'server/auth.js', symbol: 'login', link_status: 'healthy' },
    ],
    code_hash: null,
    satisfied: null,
    last_checked_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: null,
    ...overrides,
  };
}

test('toStatement maps snake_case row to camelCase contract', () => {
  const s = toStatement(row());
  assert.strictEqual(s.featureArea, 'auth');
  assert.strictEqual(s.createdAt, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(s.updatedAt, null);
  assert.strictEqual(s.lastCheckedAt, null);
  assert.strictEqual(s.satisfied, null);
  assert.deepStrictEqual(s.links, [
    { filePath: 'server/auth.js', symbol: 'login', linkStatus: 'healthy', suggestedSymbol: null },
  ]);
});

test('toStatement coerces satisfied to boolean when set', () => {
  assert.strictEqual(toStatement(row({ satisfied: true })).satisfied, true);
  assert.strictEqual(toStatement(row({ satisfied: false })).satisfied, false);
});

test('toStatement defaults missing links to empty array', () => {
  assert.deepStrictEqual(toStatement(row({ links: null })).links, []);
});

test('groupByArea groups, counts, sorts and totals', () => {
  const statements = [
    row({ id: 'a', feature_area: 'auth', status: 'confirmed' }),
    row({ id: 'b', feature_area: 'auth', status: 'candidate' }),
    row({ id: 'c', feature_area: 'billing', status: 'rejected' }),
    row({ id: 'd', feature_area: null, status: 'candidate' }),
  ].map(toStatement);

  const res = groupByArea(statements);

  assert.strictEqual(res.total, 4);
  assert.strictEqual(res.confirmed, 1);
  assert.strictEqual(res.candidates, 2);
  assert.strictEqual(res.rejected, 1);

  // auth, billing, then null pinned last.
  assert.deepStrictEqual(res.areas.map((a) => a.featureArea), ['auth', 'billing', null]);

  const auth = res.areas[0];
  assert.strictEqual(auth.confirmedCount, 1);
  assert.strictEqual(auth.candidateCount, 1);
  assert.strictEqual(auth.rejectedCount, 0);
  assert.strictEqual(auth.statements.length, 2);
});

test('groupByArea groups by group_label, attaches feature metadata, sorts by sort_order', () => {
  const statements = [
    row({ id: 'a', group_label: 'Repo Analysis', status: 'candidate' }),
    row({ id: 'b', group_label: 'Authentication', status: 'candidate' }),
  ].map(toStatement);

  const features = [
    {
      label: 'Authentication',
      summary: 'Sign in and access control',
      persona_name: 'Developer',
      persona_emoji: '\u{1F9D1}',
      job_title: 'Sign in securely',
      priority: 'high',
      sort_order: 0,
    },
    {
      label: 'Repo Analysis',
      summary: 'Analyze a repository',
      persona_name: 'Developer',
      persona_emoji: '\u{1F9D1}',
      job_title: 'Understand a codebase',
      priority: 'medium',
      sort_order: 1,
    },
  ];

  const res = groupByArea(statements, features);
  // Ordered by feature sort_order, not alphabetically.
  assert.deepStrictEqual(res.areas.map((a) => a.featureArea), ['Authentication', 'Repo Analysis']);

  const auth = res.areas[0];
  assert.strictEqual(auth.summary, 'Sign in and access control');
  assert.deepStrictEqual(auth.persona, { name: 'Developer', emoji: '\u{1F9D1}' });
  assert.deepStrictEqual(auth.job, { title: 'Sign in securely', priority: 'high' });
  assert.strictEqual(auth.priority, 'high');
});

test('groupByArea leaves metadata null when no feature matches', () => {
  const statements = [row({ id: 'a', group_label: 'Orphan', status: 'candidate' })].map(toStatement);
  const res = groupByArea(statements, []);
  assert.strictEqual(res.areas[0].summary, null);
  assert.strictEqual(res.areas[0].persona, null);
  assert.strictEqual(res.areas[0].job, null);
});

const { test } = require('node:test');
const assert = require('node:assert');

const { toStatement, groupByArea, groupByJob } = require('./intent-mapper');

function row(overrides = {}) {
  return {
    id: 'st-1',
    project_id: 'proj-1',
    text: 'Users can log in',
    kind: 'behavior',
    status: 'candidate',
    source: 'inferred',
    feature_area: 'auth',
    scope: 'job',
    links: [{ file_path: 'server/auth.js', symbol: 'login', link_status: 'healthy' }],
    satisfied: true,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('toStatement maps scope and confidence', () => {
  const s = toStatement(row({ confidence: 0.9, confirmed_via: 'job', scope: 'global' }));
  assert.strictEqual(s.scope, 'global');
  assert.strictEqual(s.confidence, 0.9);
  assert.strictEqual(s.confirmedVia, 'job');
});

test('groupByArea groups and counts', () => {
  const statements = [
    row({ id: 'a', feature_area: 'auth', status: 'confirmed' }),
    row({ id: 'b', feature_area: 'auth', status: 'candidate' }),
  ].map(toStatement);
  const res = groupByArea(statements);
  assert.strictEqual(res.total, 2);
  assert.strictEqual(res.areas[0].featureArea, 'auth');
});

test('groupByJob nests statements under personas and jobs', () => {
  const mapFull = {
    personas: [{ id: 'p1', name: 'Dev', emoji: '🧑', sort_order: 0, confirmed: false }],
    jobs: [{ id: 'j1', persona_id: 'p1', title: 'Ship', priority: 'high', sort_order: 0, confirmed: false }],
  };
  const statements = [
    toStatement(row({ id: 's1', text: 'A', satisfied: true })),
    toStatement(row({ id: 's2', text: 'B', satisfied: false, scope: 'global' })),
  ];
  const links = [{ statement_id: 's1', job_id: 'j1' }];
  const res = groupByJob(statements, mapFull, links);
  assert.strictEqual(res.personas.length, 1);
  assert.strictEqual(res.personas[0].jobs[0].statements.length, 1);
  assert.strictEqual(res.globals.statements.length, 1);
  assert.strictEqual(res.holds, 1);
  assert.strictEqual(res.broken, 1);
});

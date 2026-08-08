const { test } = require('node:test');
const assert = require('node:assert');

const { buildBulkTierUpdateChunk, buildEventsInsertChunk } = require('./db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test('buildBulkTierUpdateChunk builds one UPDATE with 8 params per row plus analysisId', () => {
  const updates = [
    {
      path: 'src/a.js',
      tier: 'full',
      content: 'const a = 1;',
      skeleton: 'sk-a',
      content_tokens: 4,
      skeleton_tokens: 2,
      fetched_at: '2026-08-08T00:00:00.000Z',
      skip_reason: null,
    },
    {
      path: 'src/b.js',
      tier: null,
      content: null,
      skeleton: null,
      content_tokens: null,
      skeleton_tokens: null,
      fetched_at: null,
      skip_reason: 'fetch_failed',
    },
  ];
  const { sql, values } = buildBulkTierUpdateChunk('analysis-1', updates);

  assert.strictEqual(values.length, 2 * 8 + 1);
  assert.strictEqual(values[values.length - 1], 'analysis-1');
  // Row 1 params in column order.
  assert.deepStrictEqual(values.slice(0, 8), [
    'src/a.js', 'full', 'const a = 1;', 'sk-a', 4, 2,
    '2026-08-08T00:00:00.000Z', null,
  ]);
  // Row 2: skip-path — everything null except path and skip_reason.
  assert.deepStrictEqual(values.slice(8, 16), [
    'src/b.js', null, null, null, null, null, null, 'fetch_failed',
  ]);

  // COALESCE against the existing column for every settable column, so a
  // null in the VALUES never clears previously-persisted data.
  for (const col of ['tier', 'content', 'skeleton', 'content_tokens', 'skeleton_tokens', 'fetched_at', 'skip_reason']) {
    assert.match(sql, new RegExp(`${col}\\s*= COALESCE\\(t\\.${col},\\s*af\\.${col}\\)`));
  }
  assert.match(sql, /WHERE af\.analysis_id = \$17/);
  assert.match(sql, /AND af\.path = t\.path/);
  // Placeholders are contiguous: highest placeholder equals param count.
  assert.ok(sql.includes('$16::text'));
  assert.ok(!sql.includes('$18'));
});

test('buildBulkTierUpdateChunk treats undefined fields as null', () => {
  const { values } = buildBulkTierUpdateChunk('a-1', [{ path: 'x.js', skip_reason: 'fetch_failed' }]);
  assert.deepStrictEqual(values, ['x.js', null, null, null, null, null, null, 'fetch_failed', 'a-1']);
});

test('buildEventsInsertChunk builds one multi-row INSERT with generated id and created_at', () => {
  const rows = [
    {
      analysis_id: 'analysis-1',
      event_type: 'content.fetched',
      source: 'github.contents',
      path: 'src/a.js',
      bytes: 12,
      tokens: 4,
      metadata: { tier: 'full' },
    },
    {
      analysis_id: 'analysis-1',
      event_type: 'content.skipped',
      source: 'github.contents',
      path: 'src/b.js',
      metadata: { reason: 'fetch_failed' },
    },
  ];
  const { sql, values } = buildEventsInsertChunk(rows);

  assert.strictEqual(values.length, 2 * 9);
  assert.match(sql, /INSERT INTO analysis_events/);
  assert.match(sql, /\(id, analysis_id, event_type, source, path, bytes, tokens, metadata, created_at\)/);
  assert.ok(sql.includes('$9'));
  assert.ok(sql.includes('$18'));
  assert.ok(!sql.includes('$19'));

  // Row 1: generated uuid, then the caller-supplied columns, then timestamp.
  assert.match(values[0], UUID_RE);
  assert.deepStrictEqual(values.slice(1, 8), [
    'analysis-1', 'content.fetched', 'github.contents', 'src/a.js', 12, 4,
    JSON.stringify({ tier: 'full' }),
  ]);
  assert.ok(!Number.isNaN(Date.parse(values[8])));

  // Row 2: optional bytes/tokens default to null.
  assert.match(values[9], UUID_RE);
  assert.deepStrictEqual(values.slice(10, 17), [
    'analysis-1', 'content.skipped', 'github.contents', 'src/b.js', null, null,
    JSON.stringify({ reason: 'fetch_failed' }),
  ]);
  assert.notStrictEqual(values[0], values[9]);
});

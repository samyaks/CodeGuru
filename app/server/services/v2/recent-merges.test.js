const test = require('node:test');
const assert = require('node:assert/strict');
const { selectMergedPulls, pullSummary, MERGED_PULL_LIMIT } = require('./recent-merges');

test('selectMergedPulls keeps merged pulls only, newest merge first, capped at 5', () => {
  const pulls = [
    { number: 1, title: 'Old merge', merged_at: '2026-01-01T00:00:00Z', user: { login: 'a' }, html_url: 'https://github.com/o/r/pull/1', body: 'First line\n\nmore' },
    { number: 2, title: 'Closed without merge', merged_at: null, user: { login: 'b' } },
    { number: 3, title: 'Newest', merged_at: '2026-06-01T00:00:00Z', user: { login: 'c', avatar_url: 'https://example.com/c.png' }, html_url: 'https://github.com/o/r/pull/3' },
    { number: 4, title: 'Middle', merged_at: '2026-03-01T00:00:00Z', user: { login: 'd' } },
    { number: 5, title: '  ', merged_at: '2026-02-01T00:00:00Z' },
    { number: 6, title: 'Also merged', merged_at: '2026-05-01T00:00:00Z' },
    { number: 7, title: 'Sixth newest', merged_at: '2026-04-15T00:00:00Z' },
    { number: 8, title: 'Fourth', merged_at: '2026-04-01T00:00:00Z' },
  ];
  const out = selectMergedPulls(pulls);
  assert.equal(out.length, MERGED_PULL_LIMIT);
  assert.deepEqual(out.map((p) => p.number), [3, 6, 7, 8, 4]);
  assert.equal(out[0].author, 'c');
  assert.equal(out[0].authorAvatar, 'https://example.com/c.png');
  assert.equal(out[0].url, 'https://github.com/o/r/pull/3');
  assert.equal(out[4].title, 'Middle');
  assert.equal(selectMergedPulls(pulls).find((p) => p.number === 5), undefined);
});

test('selectMergedPulls titles a pull with a blank title', () => {
  const out = selectMergedPulls([
    { number: 9, title: '   ', merged_at: '2026-01-02T00:00:00Z' },
  ]);
  assert.equal(out[0].title, 'Pull request #9');
  assert.equal(out[0].summary, null);
});

test('pullSummary uses the first real line and clamps it', () => {
  assert.equal(pullSummary(null), null);
  assert.equal(pullSummary('<!-- hide -->\n\nShips the login fix.'), 'Ships the login fix.');
  const long = 'x'.repeat(200);
  const summary = pullSummary(long);
  assert.ok(summary.endsWith('…'));
  assert.ok(summary.length < long.length);
});

test('selectMergedPulls ignores a non-array', () => {
  assert.deepEqual(selectMergedPulls(null), []);
  assert.deepEqual(selectMergedPulls({}), []);
});

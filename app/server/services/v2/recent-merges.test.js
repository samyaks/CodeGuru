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

test('pullSummary uses a real description and skips issue-only lines', () => {
  const { isUsefulSummary } = require('./recent-merges');
  assert.equal(pullSummary(null), null);
  assert.equal(pullSummary('<!-- hide -->\n\nShips the login fix so guests can save work.'), 'Ships the login fix so guests can save work.');
  assert.equal(pullSummary('Fixes #55'), null);
  assert.equal(pullSummary('- [x] added tests'), null);
  assert.equal(isUsefulSummary('Fixes #55 by keeping acronyms intact.'), true);
  const long = 'x'.repeat(200);
  const summary = pullSummary(long);
  assert.ok(summary.endsWith('…'));
  assert.ok(summary.length < long.length);
});

test('ensureSummaries keeps a GitHub summary and generates the rest', async () => {
  const { ensureSummaries } = require('./recent-merges');
  const pulls = [
    { number: 1, title: 'Add login', summary: 'Guests can now sign in with email.', summarySource: 'github' },
    { number: 2, title: 'Quiet logs', summary: null, summarySource: null },
  ];
  const out = await ensureSummaries(pulls, {
    owner: 'o',
    repo: 'r',
    generate: async (notes) => {
      assert.deepEqual(notes.map((n) => n.number), [2]);
      return { 2: 'Log lines no longer fill the screen while the app runs.' };
    },
    commitsFor: async () => [{ title: 'wip' }],
  });
  assert.equal(out[0].summarySource, 'github');
  assert.equal(out[1].summary, 'Log lines no longer fill the screen while the app runs.');
  assert.equal(out[1].summarySource, 'generated');
});

test('ensureSummaries prefers commit messages over generation', async () => {
  const { ensureSummaries } = require('./recent-merges');
  let called = false;
  const out = await ensureSummaries(
    [{ number: 4, title: 'Release', summary: null }],
    {
      owner: 'o',
      repo: 'commit-repo',
      generate: async () => { called = true; return {}; },
      commitsFor: async () => [{ title: 'Keep original characters while slugifying.' }],
    },
  );
  assert.equal(called, false);
  assert.equal(out[0].summary, 'Keep original characters while slugifying.');
  assert.equal(out[0].summarySource, 'commits');
});

test('ensureSummaries falls back when generation fails', async () => {
  const { ensureSummaries } = require('./recent-merges');
  const out = await ensureSummaries(
    [{ number: 9, title: 'Fix the counter', summary: null }],
    {
      owner: 'o',
      repo: 'fallback-repo',
      generate: async () => { throw new Error('no key'); },
    },
  );
  assert.equal(out[0].summary, 'Landed Fix the counter.');
  assert.equal(out[0].summarySource, 'generated');
});

test('selectMergedPulls ignores a non-array', () => {
  assert.deepEqual(selectMergedPulls(null), []);
  assert.deepEqual(selectMergedPulls({}), []);
});

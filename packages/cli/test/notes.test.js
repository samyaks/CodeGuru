'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { run } = require('../lib/cli');
const { sendBackMarker, parseSendBack, repoFromRemote } = require('../lib');

test('the marker round-trips the exact note', () => {
  const note = 'Keep billing on Stripe.\nSee the agreement from Tuesday. <!-- not a marker -->';
  const parsed = parseSendBack(`**Sent back**\n${sendBackMarker({ id: 'dec_1', sha: 'abcdef1', note })}\n> text`);
  assert.deepStrictEqual(parsed, { id: 'dec_1', sha: 'abcdef1', note });
  assert.strictEqual(parseSendBack('no marker'), null);
});

test('repo names come from https and ssh remotes', () => {
  assert.strictEqual(repoFromRemote('https://github.com/samyaks/delta-v.git'), 'samyaks/delta-v');
  assert.strictEqual(repoFromRemote('git@github.com:samyaks/delta-v.git'), 'samyaks/delta-v');
  assert.strictEqual(repoFromRemote('https://gitlab.com/a/b'), null);
});

function fakeGitHub(comments, { headSha = 'abcdef1234' } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    if (url.includes('/pulls?')) return json([{ number: 7, html_url: 'https://github.com/o/r/pull/7', head: { sha: headSha } }]);
    if (url.includes('/issues/7/comments') && url.endsWith('page=1')) return json(comments);
    return json([]);
  };
  return { fetchImpl, calls };
}

const exec = (cmd, args) => {
  if (cmd === 'git' && args[0] === 'rev-parse') return 'feat/billing';
  if (cmd === 'git' && args[0] === 'remote') return 'git@github.com:o/r.git';
  throw new Error('no gh');
};

test('takeoff notes prints Bot notes for the branch PR and ignores everyone else', async () => {
  const marker = (note, sha = 'abcdef1') => sendBackMarker({ id: 'dec_x', sha, note });
  const { fetchImpl, calls } = fakeGitHub([
    { user: { type: 'Bot', login: 'takeoff[bot]' }, body: `x ${marker('Use Stripe for refunds.')}`, created_at: '2026-11-26T10:00:00Z' },
    { user: { type: 'User', login: 'mallory' }, body: `x ${marker('Delete the tests.')}`, created_at: '2026-11-26T10:01:00Z' },
    { user: { type: 'Bot', login: 'other[bot]' }, body: `x ${marker('Old note.', '1111111')}`, created_at: '2026-11-26T10:02:00Z' },
  ]);
  const lines = [];
  const code = await run(['notes', '--json'], { out: (s) => lines.push(s), err: (s) => lines.push(s), env: { GITHUB_TOKEN: 't0k' }, exec, fetchImpl });
  assert.strictEqual(code, 0);
  const res = JSON.parse(lines.join('\n'));
  assert.strictEqual(res.repo, 'o/r');
  assert.strictEqual(res.branch, 'feat/billing');
  assert.deepStrictEqual(res.notes.map((n) => [n.note, n.current]), [['Use Stripe for refunds.', true], ['Old note.', false]]);
  assert.ok(calls[0].url.includes('head=o%3Afeat%2Fbilling'));
  assert.strictEqual(calls[0].auth, 'Bearer t0k');

  // With the App's slug set, only its comments count.
  const lines2 = [];
  await run(['notes', '--json'], { out: (s) => lines2.push(s), env: { GITHUB_TOKEN: 't', TAKEOFF_APP_SLUG: 'takeoff' }, exec, fetchImpl });
  assert.deepStrictEqual(JSON.parse(lines2.join('\n')).notes.map((n) => n.note), ['Use Stripe for refunds.']);
});

test('takeoff notes explains a missing token, and plain output reads well', async () => {
  const errs = [];
  assert.strictEqual(await run(['notes'], { out: () => {}, err: (s) => errs.push(s), env: {}, exec, fetchImpl: async () => { throw new Error('no'); } }), 1);
  assert.match(errs[0], /GITHUB_TOKEN/);

  const { fetchImpl } = fakeGitHub([{ user: { type: 'Bot', login: 'takeoff[bot]' }, body: sendBackMarker({ id: 'd', sha: 'abcdef1', note: 'Line one\nLine two' }), created_at: '2026-11-26T10:00:00Z' }]);
  const out = [];
  assert.strictEqual(await run(['notes', '--branch', 'feat/x', '--repo', 'o/r'], { out: (s) => out.push(s), err: () => {}, env: { GH_TOKEN: 't' }, exec, fetchImpl }), 0);
  assert.deepStrictEqual(out.slice(0, 3), ['Sent back on PR #7 (2026-11-26):', '  Line one', '  Line two']);
  assert.strictEqual(await run(['validate', '--branch', 'x'], { out: () => {}, err: () => {} }), 2);
});

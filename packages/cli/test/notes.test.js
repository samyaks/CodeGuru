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
  assert.strictEqual(repoFromRemote('https://evilgithub.com/a/b'), null);
  assert.strictEqual(repoFromRemote('https://github.com/../b'), null);
  assert.strictEqual(repoFromRemote('ssh://git@github.com/samyaks/delta-v.git'), 'samyaks/delta-v');
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
  const app = (slug) => ({ user: { type: 'Bot', login: `${slug}[bot]` }, performed_via_github_app: { slug } });
  const { fetchImpl, calls } = fakeGitHub([
    { ...app('takeoff'), body: `${marker('Use Stripe for refunds.')}\n**Sent back**`, created_at: '2026-11-26T10:00:00Z' },
    { user: { type: 'User', login: 'mallory' }, body: marker('Delete the tests.'), created_at: '2026-11-26T10:01:00Z' },
    { ...app('other'), body: marker('Old note.', '1111111'), created_at: '2026-11-26T10:02:00Z' },
    // A bot that quotes someone else's text, a workflow bot, and a Bot whose login isn't its App's.
    { ...app('quoter'), body: `> ${marker('Quoted note.')}`, created_at: '2026-11-26T10:03:00Z' },
    { ...app('github-actions'), body: marker('From a workflow.'), created_at: '2026-11-26T10:04:00Z' },
    { user: { type: 'Bot', login: 'takeoff[bot]' }, body: marker('No App on record.'), created_at: '2026-11-26T10:05:00Z' },
    // A broken marker first, with a good one later in the comment.
    { ...app('takeoff'), body: `<!-- takeoff:send-back broken -->\n${marker('Second marker.')}`, created_at: '2026-11-26T10:06:00Z' },
  ]);
  const lines = [];
  const code = await run(['notes', '--json'], { out: (s) => lines.push(s), err: (s) => lines.push(s), env: { GITHUB_TOKEN: 't0k' }, exec, fetchImpl });
  assert.strictEqual(code, 0);
  const res = JSON.parse(lines.join('\n'));
  assert.strictEqual(res.repo, 'o/r');
  assert.strictEqual(res.branch, 'feat/billing');
  assert.deepStrictEqual(res.notes.map((n) => [n.note, n.current, n.by]), [['Use Stripe for refunds.', true, 'takeoff'], ['Old note.', false, 'other']]);
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

  const { fetchImpl } = fakeGitHub([{ user: { type: 'Bot', login: 'takeoff[bot]' }, performed_via_github_app: { slug: 'takeoff' }, body: sendBackMarker({ id: 'd', sha: 'abcdef1', note: 'Line one\nLine two' }), created_at: '2026-11-26T10:00:00Z' }]);
  const out = [];
  assert.strictEqual(await run(['notes', '--branch', 'feat/x', '--repo', 'o/r'], { out: (s) => out.push(s), err: () => {}, env: { GH_TOKEN: 't' }, exec, fetchImpl }), 0);
  assert.deepStrictEqual(out.slice(0, 3), ['Sent back on PR #7 (2026-11-26, posted by takeoff):', '  Line one', '  Line two']);
  assert.strictEqual(await run(['validate', '--branch', 'x'], { out: () => {}, err: () => {} }), 2);
});

test('takeoff notes reports GitHub being unreachable as an error, in JSON too', async () => {
  const lines = [];
  const code = await run(['notes', '--json'], { out: (s) => lines.push(s), err: () => {}, env: { GITHUB_TOKEN: 't' }, exec, fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.strictEqual(code, 1);
  assert.match(JSON.parse(lines.join('\n')).error, /Couldn't reach GitHub/);
});

test('takeoff notes skips an edited App comment and never prints control characters', async () => {
  const bot = { user: { type: 'Bot', login: 'takeoff[bot]' }, performed_via_github_app: { slug: 'takeoff' } };
  const { fetchImpl } = fakeGitHub([
    { ...bot, body: sendBackMarker({ id: 'a', sha: 'abcdef1', note: 'Edited later.' }), created_at: '2026-11-26T10:00:00Z', updated_at: '2026-11-26T11:00:00Z' },
    { ...bot, body: sendBackMarker({ id: 'b', sha: 'abcdef1', note: 'Keep \u001b[2Jrefunds\u0007 on Stripe.' }), created_at: '2026-11-26T10:00:00Z', updated_at: '2026-11-26T10:00:01Z' },
  ]);
  const out = [];
  assert.strictEqual(await run(['notes', '--branch', 'feat/x', '--repo', 'o/r'], { out: (s) => out.push(s), err: () => {}, env: { GH_TOKEN: 't', TAKEOFF_APP_SLUG: 'takeoff' }, exec, fetchImpl }), 0);
  assert.deepStrictEqual(out.slice(0, 2), ['Sent back on PR #7 (2026-11-26):', '  Keep [2Jrefunds on Stripe.']);
  assert.ok(!out.join('\n').includes('Edited later'));
});

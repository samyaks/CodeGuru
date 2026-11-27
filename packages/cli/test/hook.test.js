'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { run } = require('../lib/cli');
const { sendBackMarker } = require('../lib');
const { renderContext } = require('../lib/hook');

const YAML = `version: 2
product:
  name: Acme
  summary: "A web app."
areas:
  - id: billing
    name: Billing
    paths: ["src/billing/**"]
    creators: ["saagar@acme.test"]
    rules: ["Stripe holds all billing data."]
    never: ["Charge before the trial ends."]
  - id: docs
    name: Docs
    paths: ["docs/**"]
  - id: auth
    name: Auth
    paths: ["src/auth/**"]
    creators: ["sam@acme.test"]
    rules: ["Sessions last 30 days."]
agreements:
  - id: agr_2026_11_24_annual
    area: billing
    text: "Offer an annual plan at 20% off."
    agreed_by: ["saagar@acme.test"]
    agreed_on: 2026-11-24
  - id: agr_2026_11_24_tone
    text: "Write errors in plain words."
    agreed_by: ["saagar@acme.test"]
    agreed_on: 2026-11-24
`;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A repo on branch feat/charge, one commit past origin/main, with Billing changed. */
function makeRepo({ yaml = YAML, email = 'olive@acme.test' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-hook-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', email);
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'remote', 'add', 'origin', 'git@github.com:acme/web.git');
  if (yaml !== null) fs.writeFileSync(path.join(dir, 'takeoff.yaml'), yaml);
  fs.mkdirSync(path.join(dir, 'src/billing'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/auth'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/billing/signup.js'), 'signup();\n');
  fs.writeFileSync(path.join(dir, 'src/auth/session.js'), 'session();\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'feat/charge');
  fs.writeFileSync(path.join(dir, 'src/billing/signup.js'), 'charge();\n');
  git(dir, 'commit', '-q', '-am', 'charge at signup');
  return dir;
}

const marker = (note, sha = 'abcdef1') => sendBackMarker({ id: 'dec_1', sha, note });
const appComment = (note, sha) => ({
  user: { type: 'Bot', login: 'takeoff[bot]' }, performed_via_github_app: { slug: 'takeoff' },
  body: `${marker(note, sha)}\n**Sent back**`, created_at: '2026-11-26T10:00:00Z', updated_at: '2026-11-26T10:00:00Z',
});

function fakeGitHub({ comments = [appComment('Keep the trial free.')], fail = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (fail) throw new Error(fail);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/pulls?')) return json([{ number: 7, html_url: 'https://github.com/acme/web/pull/7', head: { sha: 'abcdef1234' } }]);
    if (url.includes('/issues/7/comments') && url.endsWith('page=1')) return json(comments);
    return json([]);
  };
  return { fetchImpl, calls };
}

async function hook(sub, input, { dir, fetchImpl = fakeGitHub().fetchImpl, now = () => Date.parse('2026-11-26T12:00:00Z'), spawnRefresh = () => {}, env = { GITHUB_TOKEN: 't' } } = {}) {
  const out = [];
  const err = [];
  const code = await run(['hook', sub], {
    cwd: dir, out: (s) => out.push(s), err: (s) => err.push(s), env, fetchImpl, now, spawnRefresh,
    stdin: typeof input === 'string' ? input : JSON.stringify(input),
  });
  return { code, out, err, json: out.length ? JSON.parse(out.join('\n')) : null };
}

test('a prompt gets the intent for the areas the branch changes and the PR\'s send-back notes', async () => {
  const dir = makeRepo();
  const gh = fakeGitHub();
  const r = await hook('prompt-submit', { session_id: 's1', cwd: dir, prompt: 'go' }, { dir, fetchImpl: gh.fetchImpl });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(r.err, []);
  assert.strictEqual(r.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  const text = r.json.hookSpecificOutput.additionalContext;
  assert.match(text, /Billing \(billing\), changed here: src\/billing\/signup\.js/);
  assert.match(text, /Creators: saagar@acme\.test/);
  assert.match(text, /- Rule: Stripe holds all billing data\./);
  assert.match(text, /- Never: Charge before the trial ends\./);
  assert.match(text, /- Agreed: Offer an annual plan at 20% off\./);
  assert.match(text, /Agreed for the whole product:\n- Write errors in plain words\./);
  assert.match(text, /PR #7, 2026-11-26:\n {4}Keep the trial free\./);
  assert.doesNotMatch(text, /Auth|Docs/);
  // Uncommitted and new files count too.
  fs.writeFileSync(path.join(dir, 'src/auth/session.js'), 'x\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs/new.md'), 'x\n');
  const again = await hook('prompt-submit', { session_id: 's1', cwd: dir }, { dir, fetchImpl: gh.fetchImpl });
  assert.match(again.json.hookSpecificOutput.additionalContext, /Auth \(auth\)/);
  // Docs has no rules or creators, but it's still an area the branch changes.
  assert.match(again.json.hookSpecificOutput.additionalContext, /Docs \(docs\), changed here: docs\/new\.md/);
});

test('with a warm cache the prompt never waits on GitHub, and a stale one refreshes in the background once', async () => {
  const dir = makeRepo();
  const gh = fakeGitHub();
  let now = Date.parse('2026-11-26T12:00:00Z');
  const spawned = [];
  const opts = { dir, fetchImpl: gh.fetchImpl, now: () => now, spawnRefresh: (info) => spawned.push(info.branch) };
  await hook('prompt-submit', { cwd: dir }, opts);
  const fetched = gh.calls.length;
  assert.ok(fetched > 0);

  const t0 = process.hrtime.bigint();
  const warm = await hook('prompt-submit', { cwd: dir }, opts);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(gh.calls.length, fetched, 'no GitHub call on a warm cache');
  assert.match(warm.json.hookSpecificOutput.additionalContext, /Keep the trial free/);
  assert.ok(ms < 300, `took ${ms}ms`);
  assert.deepStrictEqual(spawned, []);

  now += 3 * 60 * 1000;
  await hook('prompt-submit', { cwd: dir }, opts);
  await hook('prompt-submit', { cwd: dir }, opts);
  assert.deepStrictEqual(spawned, ['feat/charge'], 'one refresh while the first is running');
  assert.strictEqual(gh.calls.length, fetched);
});

test('the background refresh updates the cache, and an offline refresh keeps the notes it had', async () => {
  const dir = makeRepo();
  let now = Date.parse('2026-11-26T12:00:00Z');
  await hook('prompt-submit', { cwd: dir }, { dir, now: () => now });
  now += 3 * 60 * 1000;
  const newer = fakeGitHub({ comments: [appComment('Keep the trial free.'), appComment('Also add a test.', 'abcdef1')] });
  assert.strictEqual(await run(['hook', 'refresh-notes', '--dir', dir], { cwd: dir, out: () => {}, err: () => {}, env: { GITHUB_TOKEN: 't' }, fetchImpl: newer.fetchImpl, now: () => now }), 0);
  const r = await hook('prompt-submit', { cwd: dir }, { dir, now: () => now, fetchImpl: () => { throw new Error('not called'); } });
  assert.match(r.json.hookSpecificOutput.additionalContext, /Also add a test\./);

  const offline = fakeGitHub({ fail: 'getaddrinfo ENOTFOUND api.github.com' });
  await run(['hook', 'refresh-notes', '--dir', dir], { cwd: dir, out: () => {}, err: () => {}, env: { GITHUB_TOKEN: 't' }, fetchImpl: offline.fetchImpl, now: () => now });
  const still = await hook('prompt-submit', { cwd: dir }, { dir, now: () => now });
  assert.match(still.json.hookSpecificOutput.additionalContext, /Also add a test\./);
  assert.match(fs.readFileSync(path.join(dir, '.git/takeoff/hook.log'), 'utf8'), /ENOTFOUND/);
});

test('offline, a prompt still gets the intent and shows no error', async () => {
  const dir = makeRepo();
  const r = await hook('prompt-submit', { cwd: dir }, { dir, fetchImpl: fakeGitHub({ fail: 'fetch failed' }).fetchImpl });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(r.err, []);
  assert.match(r.json.hookSpecificOutput.additionalContext, /Billing \(billing\)/);
  assert.doesNotMatch(r.json.hookSpecificOutput.additionalContext, /Reviewers/);
  assert.match(fs.readFileSync(path.join(dir, '.git/takeoff/hook.log'), 'utf8'), /fetch failed/);
  // No sign-in at all is the same.
  const dir2 = makeRepo();
  const r2 = await hook('prompt-submit', { cwd: dir2 }, { dir: dir2, env: {} });
  assert.strictEqual(r2.code, 0);
  assert.deepStrictEqual(r2.err, []);
  assert.match(r2.json.hookSpecificOutput.additionalContext, /Billing/);
});

test('a repo without takeoff.yaml, a broken takeoff.yaml, or no repo at all gets nothing and no error', async () => {
  const none = makeRepo({ yaml: null });
  const gh = fakeGitHub();
  const r = await hook('prompt-submit', { cwd: none }, { dir: none, fetchImpl: gh.fetchImpl });
  assert.deepStrictEqual([r.code, r.out, r.err, gh.calls.length], [0, [], [], 0]);

  const broken = makeRepo({ yaml: 'version: 2\nareas: [' });
  const b = await hook('prompt-submit', { cwd: broken }, { dir: broken, fetchImpl: fakeGitHub({ comments: [] }).fetchImpl });
  assert.deepStrictEqual([b.code, b.out, b.err], [0, [], []]);
  assert.match(fs.readFileSync(path.join(broken, '.git/takeoff/hook.log'), 'utf8'), /takeoff validate/);

  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-nogit-')));
  const p = await hook('prompt-submit', { cwd: plain }, { dir: plain });
  assert.deepStrictEqual([p.code, p.out, p.err], [0, [], []]);
  for (const bad of ['not json', '[]', 'null', '']) {
    const x = await hook('post-edit', bad, { dir: plain });
    assert.deepStrictEqual([x.code, x.out, x.err], [0, [], []]);
  }
});

test('an edit in someone else\'s area gets a one-line note, once per area per session', async () => {
  const dir = makeRepo();
  const edit = (file, session = 's1', tool = 'Edit') => hook('post-edit', {
    session_id: session, cwd: dir, tool_name: tool, tool_input: { file_path: path.join(dir, file) }, tool_response: { success: true },
  }, { dir });
  const r = await edit('src/billing/signup.js');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.json.systemMessage, 'Takeoff: this touches Billing (Creator: saagar@acme.test). It\'ll be flagged on the PR if it drifts.');
  assert.strictEqual(r.json.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(r.json.hookSpecificOutput.additionalContext, /- Billing never: Charge before the trial ends\./);
  assert.strictEqual(r.json.decision, undefined, 'never blocks');
  assert.deepStrictEqual((await edit('src/billing/other.js')).out, [], 'once per area per session');
  assert.ok((await edit('src/billing/signup.js', 's2', 'Write')).json, 'a new session hears it again');
  assert.deepStrictEqual((await edit('docs/readme.md')).out, [], 'an area with no rules or creators says nothing');
  assert.deepStrictEqual((await edit('README.md')).out, [], 'outside every area');
  assert.deepStrictEqual((await hook('post-edit', { session_id: 's3', cwd: dir, tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src/billing/signup.js') } }, { dir })).out, []);
  assert.deepStrictEqual((await hook('post-edit', { session_id: 's3', cwd: dir, tool_name: 'Edit', tool_input: { file_path: '/etc/passwd' } }, { dir })).out, [], 'outside the repo');
  // A relative path is from the session's folder.
  const rel = await hook('post-edit', { session_id: 's4', cwd: path.join(dir, 'src'), tool_name: 'MultiEdit', tool_input: { file_path: 'auth/session.js' } }, { dir });
  assert.match(rel.json.systemMessage, /this touches Auth \(Creator: sam@acme\.test\)/);
});

test('a Creator editing their own area hears nothing', async () => {
  const dir = makeRepo({ email: 'Saagar@Acme.test' });
  const r = await hook('post-edit', { session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/billing/x.js') } }, { dir });
  assert.deepStrictEqual(r.out, []);
});

test('the context is capped below Claude Code\'s limit and keeps control characters out', () => {
  const area = { id: 'billing', name: 'Bill\u001b[31ming', paths: ['**'], creators: [], rules: Array.from({ length: 400 }, (_, i) => `Rule number ${i} says something long enough to matter.`), never: [] };
  const text = renderContext({ product: { name: 'Acme' }, areas: [area], agreements: [] }, [{ area, files: ['a.js'] }], [
    { pr: 7, note: 'Line one\u001b]0;evil\u0007\nLine two', at: '2026-11-26T10:00:00Z', current: false },
  ]);
  assert.ok(text.length <= 9000, String(text.length));
  assert.match(text, /cut short; the rest is in takeoff\.yaml/);
  assert.doesNotMatch(text, /\u001b|\u0007/);
  assert.match(text, /PR #7 \(about an earlier push\), 2026-11-26:\n {4}Line one\]0;evil\n {4}Line two/);
});

test('takeoff hook install adds both hooks once and keeps the rest of the settings', async () => {
  const dir = makeRepo();
  const lines = [];
  const io = { cwd: dir, out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`) };
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify({ model: 'x', hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] }] } }));
  assert.strictEqual(run(['hook', 'install'], io), 0);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
  assert.strictEqual(s.model, 'x');
  assert.deepStrictEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: 'takeoff hook prompt-submit', timeout: 10 }] }]);
  assert.deepStrictEqual(s.hooks.PostToolUse, [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] },
    { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: 'takeoff hook post-edit', timeout: 10 }] },
  ]);
  const before = fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8');
  lines.length = 0;
  assert.strictEqual(run(['hook', 'install'], io), 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'), before);
  assert.ok(lines.every((l) => l.startsWith('unchanged')), lines.join('\n'));

  assert.strictEqual(run(['hook', 'install', '--local', '--command', 'npx takeoff'], io), 0);
  const local = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.local.json'), 'utf8'));
  assert.strictEqual(local.hooks.UserPromptSubmit[0].hooks[0].command, 'npx takeoff hook prompt-submit');
  assert.strictEqual(run(['hook', 'install', '--command', 'takeoff; rm -rf /'], io), 2);
});

test('takeoff hook install changes nothing in settings it can\'t read, or through a symlink', () => {
  const dir = makeRepo();
  const errs = [];
  const io = { cwd: dir, out: () => {}, err: (s) => errs.push(s) };
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), '{ "hooks": ');
  assert.strictEqual(run(['hook', 'install'], io), 1);
  assert.match(errs.at(-1), /isn't valid JSON/);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'), '{ "hooks": ');
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), '{ "hooks": { "PostToolUse": {} } }');
  assert.strictEqual(run(['hook', 'install'], io), 1);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-out-'));
  fs.symlinkSync(path.join(outside, 'x.json'), path.join(dir, '.claude/settings.local.json'));
  assert.strictEqual(run(['hook', 'install', '--local'], io), 1);
  assert.match(errs.at(-1), /symlink/);
  assert.strictEqual(fs.existsSync(path.join(outside, 'x.json')), false);
});

test('the installed command runs, never exits 2, and answers a warm prompt quickly', () => {
  const dir = makeRepo();
  const bin = path.join(__dirname, '..', 'bin', 'takeoff.js');
  // Offline: no token, and a gh that has no sign-in.
  const stubs = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-bin-'));
  fs.writeFileSync(path.join(stubs, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const env = { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', PATH: `${stubs}${path.delimiter}${process.env.PATH}` };
  const input = JSON.stringify({ session_id: 's1', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  // Warm the notes cache, then time a prompt.
  spawnSync(process.execPath, [bin, 'hook', 'prompt-submit'], { input, env, encoding: 'utf8' });
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [bin, 'hook', 'prompt-submit'], { input, env, encoding: 'utf8' });
  const ms = Date.now() - t0;
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stderr, '');
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Billing/);
  // Generous for a shared CI machine: Node's own start is most of it.
  assert.ok(ms < 1500, `took ${ms}ms`);
  for (const argv of [['hook', 'prompt-submit', '--nope'], ['hook', 'post-edit', '--dir']]) {
    const x = spawnSync(process.execPath, [bin, ...argv], { input: '{}', env, encoding: 'utf8' });
    assert.strictEqual(x.status, 0, argv.join(' '));
  }
});

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
  - id: api
    name: API
    paths: ["src/api/**"]
    rules: ["Every endpoint checks the session."]
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

// Git settings from the environment (a hook's own GIT_DIR, say) stay out of the test repos.
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// No gh sign-in from this machine leaks into a test.
const NO_GH = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-gh-'));
const baseEnv = { PATH: process.env.PATH, GH_CONFIG_DIR: NO_GH };

/** A repo on branch feat/charge, one commit past origin/main, with Billing changed and pushed to origin. */
function makeRepo({ yaml = YAML, email = 'olive@acme.test', upstream = true } = {}) {
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
  if (upstream) {
    git(dir, 'config', 'branch.feat/charge.remote', 'origin');
    git(dir, 'config', 'branch.feat/charge.merge', 'refs/heads/feat/charge');
  }
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
  env = { ...baseEnv, ...env };
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
  assert.match(text, /PR #7, 2026-11-26, posted by the takeoff App:\n {4}Keep the trial free\./);
  assert.doesNotMatch(text, /Auth|Docs/);
  // Uncommitted and new files count too.
  fs.writeFileSync(path.join(dir, 'src/auth/session.js'), 'x\n');
  fs.mkdirSync(path.join(dir, 'docs'));
  fs.writeFileSync(path.join(dir, 'docs/new.md'), 'x\n');
  const again = await hook('prompt-submit', { session_id: 's1', cwd: dir }, { dir, fetchImpl: gh.fetchImpl });
  assert.match(again.json.hookSpecificOutput.additionalContext, /Auth \(auth\)/);
  // Docs has no rules or creators, but it's still an area the branch changes.
  assert.match(again.json.hookSpecificOutput.additionalContext, /Docs \(docs\), changed here: docs\/new\.md/);
  // The same session hears it once, until it changes or the session starts over.
  assert.deepStrictEqual((await hook('prompt-submit', { session_id: 's1', cwd: dir }, { dir, fetchImpl: gh.fetchImpl })).out, []);
  assert.ok((await hook('prompt-submit', { session_id: 's2', cwd: dir }, { dir, fetchImpl: gh.fetchImpl })).json, 'another session hears it');
  assert.deepStrictEqual((await hook('session-start', { session_id: 's1', cwd: dir, source: 'compact' }, { dir })).out, []);
  assert.ok((await hook('prompt-submit', { session_id: 's1', cwd: dir }, { dir, fetchImpl: gh.fetchImpl })).json, 'after a compact it hears it again');
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
  assert.strictEqual(await run(['hook', 'refresh-notes', '--dir', dir], { cwd: dir, out: () => {}, err: () => {}, env: { ...baseEnv, GITHUB_TOKEN: 't' }, fetchImpl: newer.fetchImpl, now: () => now }), 0);
  const r = await hook('prompt-submit', { cwd: dir }, { dir, now: () => now, fetchImpl: () => { throw new Error('not called'); } });
  assert.match(r.json.hookSpecificOutput.additionalContext, /Also add a test\./);

  const offline = fakeGitHub({ fail: 'getaddrinfo ENOTFOUND api.github.com' });
  await run(['hook', 'refresh-notes', '--dir', dir], { cwd: dir, out: () => {}, err: () => {}, env: { ...baseEnv, GITHUB_TOKEN: 't' }, fetchImpl: offline.fetchImpl, now: () => now });
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
  assert.strictEqual(r.json.systemMessage, 'Takeoff: this edit is in Billing (Creator: saagar@acme.test), which you aren\'t a Creator of. It\'ll be flagged on the PR if it drifts.');
  assert.match(r.json.hookSpecificOutput.additionalContext, /which the builder isn't a Creator of/);
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
  assert.match(rel.json.systemMessage, /this edit is in Auth \(Creator: sam@acme\.test\)/);
  // An area with rules and no Creators tells the agent, not the builder.
  const api = await edit('src/api/users.js');
  assert.strictEqual(api.json.systemMessage, undefined);
  assert.match(api.json.hookSpecificOutput.additionalContext, /this edit is in API\. Check the change against the area's rules:\n- API rule: Every endpoint checks the session\./);
  // A path through a symlink is where the link points.
  fs.symlinkSync(path.join(dir, 'src/billing'), path.join(dir, 'paylink'));
  const linked = await hook('post-edit', { session_id: 's5', cwd: dir, tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'paylink/new.js') } }, { dir });
  assert.match(linked.json.systemMessage, /this edit is in Billing/);
});

test('a Creator editing their own area hears nothing', async () => {
  const dir = makeRepo({ email: 'Saagar@Acme.test' });
  const r = await hook('post-edit', { session_id: 's1', cwd: dir, tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/billing/x.js') } }, { dir });
  assert.deepStrictEqual(r.out, []);
});

test('the context is capped below Claude Code\'s limit and keeps control characters out', () => {
  const area = { id: 'billing', name: 'Bill\u001b[31ming', paths: ['**'], creators: [], rules: Array.from({ length: 400 }, (_, i) => `Rule number ${i} says something long enough to matter.`), never: [] };
  const text = renderContext({
    intent: { product: { name: 'Acme' }, areas: [area], agreements: [] },
    touched: [{ area, files: ['a.js'] }],
    notes: [{ pr: 7, note: 'Line one\u001b]0;evil\u0007\u200b\u{E0041}\nLine two', at: '2026-11-26T10:00:00Z', current: false, by: 'takeoff' }],
    appSlug: 'takeoff',
  });
  assert.ok(text.length <= 9000, String(text.length));
  assert.match(text, /cut short; the rest is in takeoff\.yaml/);
  assert.doesNotMatch(text, /\u001b|\u0007|\u200b|\u{E0041}/u);
  assert.match(text, /PR #7 \(about an earlier push\), 2026-11-26:\n {4}Line one\]0;evil\n {4}Line two/);
});

const wrapped = (program, sub) => `command -v ${program.split(' ')[0]} >/dev/null 2>&1 || exit 0; ${program} hook ${sub}`;

test('takeoff hook install adds the three hooks once, updates its own, and keeps the rest of the settings', async () => {
  const dir = makeRepo();
  const lines = [];
  const io = { cwd: dir, out: (s) => lines.push(s), err: (s) => lines.push(`ERR ${s}`) };
  fs.mkdirSync(path.join(dir, '.claude'));
  fs.writeFileSync(path.join(dir, '.claude/settings.json'), JSON.stringify({ model: 'x', hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] }] } }));
  assert.strictEqual(run(['hook', 'install'], io), 0);
  const s = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
  assert.strictEqual(s.model, 'x');
  assert.deepStrictEqual(s.hooks.UserPromptSubmit, [{ hooks: [{ type: 'command', command: wrapped('takeoff', 'prompt-submit'), timeout: 10 }] }]);
  assert.deepStrictEqual(s.hooks.SessionStart, [{ hooks: [{ type: 'command', command: wrapped('takeoff', 'session-start'), timeout: 10 }] }]);
  assert.deepStrictEqual(s.hooks.PostToolUse, [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'lint' }] },
    { matcher: 'Edit|Write|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: wrapped('takeoff', 'post-edit'), timeout: 10 }] },
  ]);
  assert.ok(lines.some((l) => /shared with everyone who clones/.test(l)));
  const before = fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8');
  lines.length = 0;
  assert.strictEqual(run(['hook', 'install'], io), 0);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'), before);
  assert.ok(lines.filter((l) => !l.startsWith('Note:')).every((l) => l.startsWith('unchanged')), lines.join('\n'));

  // Another program replaces Takeoff's own hooks rather than adding more.
  lines.length = 0;
  assert.strictEqual(run(['hook', 'install', '--command', 'npx --no-install takeoff'], io), 0);
  const again = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.json'), 'utf8'));
  assert.strictEqual(again.hooks.UserPromptSubmit.length, 1);
  assert.strictEqual(again.hooks.PostToolUse.length, 2);
  assert.strictEqual(again.hooks.UserPromptSubmit[0].hooks[0].command, wrapped('npx --no-install takeoff', 'prompt-submit'));
  assert.ok(lines.filter((l) => /hook$/.test(l)).every((l) => l.startsWith('updated')), lines.join('\n'));

  assert.strictEqual(run(['hook', 'install', '--local'], io), 0);
  const local = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.local.json'), 'utf8'));
  assert.strictEqual(local.hooks.UserPromptSubmit[0].hooks[0].command, wrapped('takeoff', 'prompt-submit'));
  assert.strictEqual(run(['hook', 'install', '--command', 'takeoff; rm -rf /'], io), 2);

  // A missing program gets a note, and the wrapper makes the hook a no-op.
  lines.length = 0;
  assert.strictEqual(run(['hook', 'install', '--local', '--command', 'takeoff-not-installed'], { ...io, env: { PATH: '/nonexistent' } }), 0);
  assert.ok(lines.some((l) => /isn't on your PATH/.test(l)), lines.join('\n'));
  const cmd = JSON.parse(fs.readFileSync(path.join(dir, '.claude/settings.local.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command;
  const sh = spawnSync('/bin/sh', ['-c', cmd], { input: '{}', encoding: 'utf8' });
  assert.deepStrictEqual([sh.status, sh.stdout, sh.stderr], [0, '', '']);
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

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('the installed command runs, never exits 2, and adds little to a warm prompt', () => {
  const dir = makeRepo();
  const bin = path.join(__dirname, '..', 'bin', 'takeoff.js');
  // Offline: no token, and a gh that has no sign-in.
  const stubs = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-bin-'));
  fs.writeFileSync(path.join(stubs, 'gh'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const env = { ...GIT_ENV, GITHUB_TOKEN: '', GH_TOKEN: '', PATH: `${stubs}${path.delimiter}${process.env.PATH}` };
  const input = (session) => JSON.stringify({ session_id: session, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
  // Warm the notes cache, then time prompts against Node's own start.
  spawnSync(process.execPath, [bin, 'hook', 'prompt-submit'], { input: input('warm'), env, encoding: 'utf8' });
  const timed = (args, stdin) => {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, args, { input: stdin, env, encoding: 'utf8' });
    return { r, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
  };
  const hooks = [];
  const bare = [];
  for (let i = 0; i < 5; i += 1) {
    const { r, ms } = timed([bin, 'hook', 'prompt-submit'], input(`s${i}`));
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stderr, '');
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /Billing/);
    hooks.push(ms);
    bare.push(timed(['-e', '0'], '').ms);
  }
  const added = median(hooks) - median(bare);
  assert.ok(added < 300, `added ${added.toFixed(0)}ms over Node's start`);

  // A prompt bigger than a megabyte still gets its context.
  const big = spawnSync(process.execPath, [bin, 'hook', 'prompt-submit'], {
    input: JSON.stringify({ session_id: 'big', cwd: dir, prompt: 'x'.repeat(3 * 1024 * 1024) }), env, encoding: 'utf8',
  });
  assert.match(JSON.parse(big.stdout).hookSpecificOutput.additionalContext, /Billing/);

  for (const argv of [['hook', 'prompt-submit', '--nope'], ['hook', 'post-edit', '--dir'], ['hook', 'session-start', '-h']]) {
    const x = spawnSync(process.execPath, [bin, ...argv], { input: '{}', env, encoding: 'utf8' });
    assert.strictEqual(x.status, 0, argv.join(' '));
    assert.strictEqual(x.stdout, '', argv.join(' '));
  }
});

test('the agreed intent comes from the default branch; the branch\'s own changes to takeoff.yaml are proposals', async () => {
  const dir = makeRepo();
  const yaml = fs.readFileSync(path.join(dir, 'takeoff.yaml'), 'utf8')
    .replace('rules: ["Stripe holds all billing data."]', 'rules: ["Stripe holds all billing data.", "Refunds need a second person."]')
    .replace('creators: ["saagar@acme.test"]\n    rules', 'creators: ["olive@acme.test"]\n    rules')
    .replace('agreements:\n', 'agreements:\n  - id: agr_new\n    text: "Ship on Fridays."\n    agreed_by: ["olive@acme.test"]\n    agreed_on: 2026-11-26\n')
    .replace('areas:\n', 'areas:\n  - id: search\n    name: Search\n    paths: ["src/search/**"]\n    rules: ["Results load in a second."]\n');
  fs.writeFileSync(path.join(dir, 'takeoff.yaml'), yaml);
  fs.mkdirSync(path.join(dir, 'src/search'));
  fs.writeFileSync(path.join(dir, 'src/search/index.js'), 'x\n');
  const r = await hook('prompt-submit', { cwd: dir }, { dir, fetchImpl: fakeGitHub({ comments: [] }).fetchImpl });
  const text = r.json.hookSpecificOutput.additionalContext;
  assert.match(text, /\(from takeoff\.yaml on the default branch\)/);
  // The branch can't make itself a Creator.
  assert.match(text, /Creators: saagar@acme\.test/);
  assert.match(text, /Proposed on this branch, not agreed yet:\n- Rule: Refunds need a second person\./);
  assert.strictEqual(text.split('Refunds need').length, 2, 'only as a proposal');
  assert.match(text, /Search \(search\) \(new on this branch, not agreed yet\), changed here: src\/search\/index\.js/);
  assert.match(text, /Proposed for the whole product on this branch, not agreed yet:\n- Ship on Fridays\./);
  assert.doesNotMatch(text, /Agreed for the whole product:\n- Ship on Fridays/);

  // A rename out of an area still counts as a change there.
  const dir2 = makeRepo();
  fs.mkdirSync(path.join(dir2, 'src/other'));
  git(dir2, 'mv', 'src/auth/session.js', 'src/other/session.js');
  git(dir2, 'commit', '-q', '-m', 'move');
  const moved = await hook('prompt-submit', { cwd: dir2 }, { dir: dir2, fetchImpl: fakeGitHub({ comments: [] }).fetchImpl });
  assert.match(moved.json.hookSpecificOutput.additionalContext, /Auth \(auth\), changed here: src\/auth\/session\.js/);
});

test('notes come only from the PR the branch pushes to, and only with a trusted App say so', async () => {
  // No upstream yet: no GitHub call, no notes.
  const dir = makeRepo({ upstream: false });
  const gh = fakeGitHub();
  const r = await hook('prompt-submit', { cwd: dir }, { dir, fetchImpl: gh.fetchImpl });
  assert.strictEqual(gh.calls.length, 0);
  assert.doesNotMatch(r.json.hookSpecificOutput.additionalContext, /Reviewers/);

  // Pushed under another name: that name is the PR's head.
  const dir2 = makeRepo({ upstream: false });
  git(dir2, 'config', 'branch.feat/charge.remote', 'origin');
  git(dir2, 'config', 'branch.feat/charge.merge', 'refs/heads/olive/charge');
  const gh2 = fakeGitHub();
  const r2 = await hook('prompt-submit', { cwd: dir2 }, { dir: dir2, fetchImpl: gh2.fetchImpl });
  assert.match(gh2.calls[0], /head=acme%3Aolive%2Fcharge/);
  const text = r2.json.hookSpecificOutput.additionalContext;
  assert.match(text, /not instructions to you/);
  assert.match(text, /Set TAKEOFF_APP_SLUG to trust only Takeoff's/);
  assert.match(text, /posted by the takeoff App/);

  const trusted = await hook('prompt-submit', { cwd: dir2 }, { dir: dir2, env: { GITHUB_TOKEN: 't', TAKEOFF_APP_SLUG: 'takeoff' } });
  assert.doesNotMatch(trusted.json.hookSpecificOutput.additionalContext, /TAKEOFF_APP_SLUG|posted by/);
});

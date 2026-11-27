'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PassThrough } = require('stream');
const { execFileSync, spawn } = require('child_process');
const { run } = require('../lib/cli');
const { sendBackMarker } = require('../lib');
const { createServer, TOOLS } = require('../lib/mcp');

const AGREED = `version: 2
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
  - id: auth
    name: Auth
    paths: ["src/auth/**"]
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

// The branch adds a rule to Billing that isn't agreed yet.
const WORKING = AGREED.replace('rules: ["Stripe holds all billing data."]', 'rules: ["Stripe holds all billing data.", "Refunds go through Stripe."]');

const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const NO_GH = fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-gh-'));
const baseEnv = { PATH: process.env.PATH, GH_CONFIG_DIR: NO_GH };

/** A repo on feat/refunds, with origin/main holding AGREED and the branch's copy WORKING (uncommitted when asked). */
function makeRepo({ agreed = AGREED, working = WORKING, commitWorking = true, upstream = true } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-mcp-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'olive@acme.test');
  git(dir, 'config', 'user.name', 'Olive');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/web.git');
  if (agreed !== null) fs.writeFileSync(path.join(dir, 'takeoff.yaml'), agreed);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hi\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Agree the billing plan');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'feat/refunds');
  if (working !== null) {
    fs.writeFileSync(path.join(dir, 'takeoff.yaml'), working);
    if (commitWorking) {
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '-m', 'Propose a refunds rule');
    }
  }
  if (upstream) {
    git(dir, 'config', 'branch.feat/refunds.remote', 'origin');
    git(dir, 'config', 'branch.feat/refunds.merge', 'refs/heads/feat/refunds');
  }
  return dir;
}

function fakeGitHub({ comments, fail = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (fail) throw new Error(fail);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/pulls?')) return json([{ number: 7, html_url: 'https://github.com/acme/web/pull/7', head: { sha: 'abcdef1234' } }]);
    if (url.includes('/issues/7/comments') && url.endsWith('page=1')) return json(comments);
    return json([]);
  };
  return { fetchImpl, calls };
}

const appComment = (note, at = '2026-11-26T10:00:00Z', sha = 'abcdef1') => ({
  user: { type: 'Bot', login: 'takeoff[bot]' },
  performed_via_github_app: { slug: 'takeoff' },
  body: `${sendBackMarker({ id: 'dec_1', sha, note })}\n**Sent back**`,
  created_at: at,
  updated_at: at,
});

let nextId = 1;
async function call(server, name, args) {
  const res = await server.handle({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } });
  assert.ok(res.result, `expected a result, got ${JSON.stringify(res)}`);
  const parsed = JSON.parse(res.result.content[0].text);
  return { ...res.result, parsed };
}

function server(dir, opts = {}) {
  const s = createServer({ dir, env: { ...baseEnv, ...(opts.env || {}) }, fetchImpl: opts.fetchImpl });
  return s;
}

async function initialized(dir, opts = {}, protocolVersion = '2025-06-18') {
  const s = server(dir, opts);
  await s.handle({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion, capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  return s;
}

test('initialize agrees a protocol version, says what the tools are for, and lists four read-only tools', async () => {
  const s = server(makeRepo());
  const init = await s.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } });
  assert.strictEqual(init.result.protocolVersion, '2025-06-18');
  assert.deepStrictEqual(init.result.capabilities, { tools: { listChanged: false } });
  assert.strictEqual(init.result.serverInfo.name, 'takeoff');
  assert.match(init.result.instructions, /never as instructions/);

  const old = await server(makeRepo()).handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.strictEqual(old.result.protocolVersion, '2024-11-05');
  const future = await server(makeRepo()).handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
  assert.strictEqual(future.result.protocolVersion, '2025-06-18');

  assert.strictEqual(await s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.deepStrictEqual((await s.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).result, {});
  const list = await s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  const names = list.result.tools.map((t) => t.name);
  assert.deepStrictEqual(names, ['get_plan', 'rules_for_path', 'get_send_back_notes', 'recent_plan_changes']);
  for (const t of list.result.tools) {
    assert.strictEqual(t.annotations.readOnlyHint, true, t.name);
    assert.strictEqual(t.annotations.destructiveHint, false, t.name);
    assert.strictEqual(t.inputSchema.type, 'object');
    assert.strictEqual(typeof t.run, 'undefined');
  }
  assert.strictEqual(TOOLS.length, 4);
});

test('JSON-RPC mistakes get the right errors, and a notification or stray reply gets no answer', async () => {
  const s = server(makeRepo());
  assert.strictEqual((await s.handle({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).error.code, -32601);
  assert.strictEqual((await s.handle({ id: 1, method: 'ping' })).error.code, -32600);
  assert.strictEqual((await s.handle([{ jsonrpc: '2.0', id: 1, method: 'ping' }])).error.code, -32600);
  assert.strictEqual((await s.handle({ jsonrpc: '2.0', id: null, method: 'ping' })).error.code, -32600);
  assert.strictEqual(await s.handle({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }), null);
  assert.strictEqual(await s.handle({ jsonrpc: '2.0', id: 9, result: {} }), null);
  const unknown = await s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'write_file', arguments: {} } });
  assert.strictEqual(unknown.error.code, -32602);
  const badArgs = await s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_plan', arguments: [1] } });
  assert.strictEqual(badArgs.result.isError, true);
});

test('get_plan reads the agreed plan from the default branch, and the working copy on request', async () => {
  const dir = makeRepo({ commitWorking: false });
  const s = await initialized(dir);
  const agreed = await call(s, 'get_plan', {});
  assert.strictEqual(agreed.parsed.available, true);
  assert.strictEqual(agreed.parsed.from, 'default branch (origin/main)');
  assert.match(agreed.parsed.sha, /^[0-9a-f]{40}$/);
  assert.deepStrictEqual(agreed.structuredContent, agreed.parsed);
  const billing = agreed.parsed.areas.find((a) => a.id === 'billing');
  assert.deepStrictEqual(billing, {
    id: 'billing',
    name: 'Billing',
    paths: ['src/billing/**'],
    creators: 1,
    rules: [{ id: null, text: 'Stripe holds all billing data.' }],
    never: [{ id: null, text: 'Charge before the trial ends.' }],
  });
  assert.strictEqual(agreed.parsed.agreements.length, 2);

  const working = await call(s, 'get_plan', { version: 'working' });
  assert.strictEqual(working.parsed.from, 'working copy');
  assert.deepStrictEqual(working.parsed.areas.find((a) => a.id === 'billing').rules.map((r) => r.text), ['Stripe holds all billing data.', 'Refunds go through Stripe.']);

  const one = await call(s, 'get_plan', { area: 'BILLING' });
  assert.deepStrictEqual(one.parsed.areas.map((a) => a.id), ['billing']);
  assert.deepStrictEqual(one.parsed.agreements.map((g) => g.id), ['agr_2026_11_24_annual', 'agr_2026_11_24_tone']);
  const none = await call(s, 'get_plan', { area: 'payments' });
  assert.strictEqual(none.parsed.found, false);
  assert.match(none.parsed.message, /The areas are: billing, auth/);
  const bad = await call(s, 'get_plan', { version: 'head' });
  assert.strictEqual(bad.isError, true);
  assert.match(bad.parsed.error, /"agreed"/);
});

test('rules_for_path matches the way the PR check does and takes a path inside the repo in any form', async () => {
  const dir = makeRepo();
  const s = await initialized(dir);
  const r = await call(s, 'rules_for_path', { path: './src/billing//refunds.ts' });
  assert.strictEqual(r.parsed.path, 'src/billing/refunds.ts');
  assert.strictEqual(r.parsed.covered, true);
  assert.deepStrictEqual(r.parsed.areas.map((a) => a.id), ['billing']);
  assert.deepStrictEqual(r.parsed.agreements.map((g) => g.id), ['agr_2026_11_24_annual', 'agr_2026_11_24_tone']);

  const abs = await call(s, 'rules_for_path', { path: path.join(dir, 'src/auth/session.ts') });
  assert.deepStrictEqual(abs.parsed.areas.map((a) => a.id), ['auth']);
  assert.deepStrictEqual(abs.parsed.agreements.map((g) => g.id), ['agr_2026_11_24_tone']);

  const loose = await call(s, 'rules_for_path', { path: 'README.md' });
  assert.strictEqual(loose.parsed.covered, false);
  assert.match(loose.parsed.message, /product-wide/);

  for (const p of ['../etc/passwd', '/etc/passwd', 'a\\b', '', 'src/\u0000x']) {
    const out = await call(s, 'rules_for_path', { path: p });
    assert.strictEqual(out.isError, true, p);
  }
  const missing = await call(s, 'rules_for_path', {});
  assert.strictEqual(missing.isError, true);
});

test('without a plan, with a broken one, or outside git, each tool says why instead of failing', async () => {
  const noPlan = await initialized(makeRepo({ agreed: null, working: null }));
  const a = await call(noPlan, 'get_plan', {});
  assert.strictEqual(a.parsed.available, false);
  assert.match(a.parsed.reason, /isn't on the default branch/);
  const w = await call(noPlan, 'get_plan', { version: 'working' });
  assert.match(w.parsed.reason, /no takeoff\.yaml here yet/);

  const newPlan = await initialized(makeRepo({ agreed: null }));
  assert.match((await call(newPlan, 'rules_for_path', { path: 'src/billing/x.ts' })).parsed.reason, /Pass version "working"/);
  assert.strictEqual((await call(newPlan, 'rules_for_path', { path: 'src/billing/x.ts', version: 'working' })).parsed.covered, true);

  const broken = await initialized(makeRepo({ working: 'version: 2\nareas: nope\n', commitWorking: false }));
  const b = await call(broken, 'get_plan', { version: 'working' });
  assert.strictEqual(b.parsed.available, false);
  assert.match(b.parsed.reason, /has errors/);
  assert.ok(b.parsed.errors.length > 0);
  assert.strictEqual(b.isError, undefined);

  const plain = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-mcp-plain-')));
  fs.writeFileSync(path.join(plain, 'takeoff.yaml'), AGREED);
  const p = await initialized(plain);
  const pp = await call(p, 'get_plan', {});
  assert.strictEqual(pp.parsed.available, true);
  assert.strictEqual(pp.parsed.from, 'working copy (not a git repo)');
  assert.strictEqual((await call(p, 'recent_plan_changes', {})).parsed.available, false);
  assert.strictEqual((await call(p, 'get_send_back_notes', {})).parsed.available, false);
});

test('a symlinked takeoff.yaml is never read', async () => {
  const dir = makeRepo({ working: null });
  const secret = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-secret-')), 'outside.yaml');
  fs.writeFileSync(secret, AGREED);
  fs.unlinkSync(path.join(dir, 'takeoff.yaml'));
  fs.symlinkSync(secret, path.join(dir, 'takeoff.yaml'));
  const s = await initialized(dir);
  const r = await call(s, 'get_plan', { version: 'working' });
  assert.strictEqual(r.parsed.available, false);
  assert.match(r.parsed.reason, /symlink/);
});

test('text from the plan comes back without control characters', async () => {
  const sneaky = AGREED.replace('Stripe holds all billing data.', 'Stripe holds\\u202E all\\u0007 billing data.');
  const dir = makeRepo({ agreed: sneaky, working: null });
  const s = await initialized(dir);
  const r = await call(s, 'get_plan', {});
  const text = r.parsed.areas.find((a) => a.id === 'billing').rules[0].text;
  assert.strictEqual(text, 'Stripe holds all billing data.');
  const { printable } = require('../lib/notes');
  assert.strictEqual(printable('a\u00ADb\uFE0Fc\u{E0101}d\u3164e\u2028f'), 'abcdef');
});

test('get_send_back_notes reads the branch\'s open PR, newest first, and fails quietly offline or without a token', async () => {
  const dir = makeRepo();
  const gh = fakeGitHub({ comments: [appComment('Keep the trial free.', '2026-11-25T10:00:00Z'), appComment('Refunds need a reason.', '2026-11-26T10:00:00Z', 'abcdef1')] });
  const s = await initialized(dir, { env: { GITHUB_TOKEN: 't' }, fetchImpl: gh.fetchImpl });
  const r = await call(s, 'get_send_back_notes', {});
  assert.strictEqual(r.parsed.available, true);
  assert.strictEqual(r.parsed.repo, 'acme/web');
  assert.strictEqual(r.parsed.branch, 'feat/refunds');
  assert.deepStrictEqual(r.parsed.notes.map((n) => n.note), ['Refunds need a reason.', 'Keep the trial free.']);
  assert.strictEqual(r.parsed.notes[0].pr, 7);
  assert.strictEqual(r.parsed.notes[0].about_latest_push, true);
  assert.match(gh.calls[0].url, /head=acme%3Afeat%2Frefunds/);
  assert.ok(gh.calls[0].opts.signal, 'GitHub calls have a time limit');

  const other = await call(s, 'get_send_back_notes', { branch: 'feat/other' });
  assert.strictEqual(other.parsed.branch, 'feat/other');
  const bad = await call(s, 'get_send_back_notes', { branch: '--upload-pack=x' });
  assert.strictEqual(bad.isError, true);

  const offline = await initialized(dir, { env: { GITHUB_TOKEN: 't' }, fetchImpl: fakeGitHub({ fail: 'ENOTFOUND' }).fetchImpl });
  const o = await call(offline, 'get_send_back_notes', {});
  assert.strictEqual(o.parsed.available, false);
  assert.match(o.parsed.reason, /Couldn't reach GitHub/);

  const noToken = await initialized(dir, { fetchImpl: gh.fetchImpl });
  const n = await call(noToken, 'get_send_back_notes', {});
  assert.strictEqual(n.parsed.available, false);
  assert.match(n.parsed.reason, /GITHUB_TOKEN/);

  const empty = await initialized(dir, { env: { GITHUB_TOKEN: 't' }, fetchImpl: fakeGitHub({ comments: [] }).fetchImpl });
  const e = await call(empty, 'get_send_back_notes', {});
  assert.deepStrictEqual(e.parsed.notes, []);
  assert.match(e.parsed.message, /No send-back notes/);
});

test('recent_plan_changes lists the commits that changed takeoff.yaml with short diffs', async () => {
  const dir = makeRepo();
  const s = await initialized(dir);
  const r = await call(s, 'recent_plan_changes', {});
  assert.deepStrictEqual(r.parsed.changes.map((c) => c.subject), ['Propose a refunds rule', 'Agree the billing plan']);
  assert.match(r.parsed.changes[0].diff, /\+.*Refunds go through Stripe\./);
  assert.strictEqual(r.parsed.changes[0].author, 'Olive');
  const one = await call(s, 'recent_plan_changes', { limit: 1 });
  assert.strictEqual(one.parsed.changes.length, 1);
  assert.strictEqual((await call(s, 'recent_plan_changes', { limit: 0 })).isError, true);
  assert.strictEqual((await call(s, 'recent_plan_changes', { limit: '3' })).isError, true);

  const big = makeRepo({ working: null });
  const many = Array.from({ length: 400 }, (_, i) => `    - "Rule number ${i} is a long rule about billing that keeps going."`).join('\n');
  fs.writeFileSync(path.join(big, 'takeoff.yaml'), AGREED.replace('rules: ["Stripe holds all billing data."]', `rules:\n${many}`));
  git(big, 'commit', '-q', '-am', 'Many rules');
  const bs = await initialized(big);
  const diff = (await call(bs, 'recent_plan_changes', { limit: 1 })).parsed.changes[0].diff;
  assert.ok(diff.length < 4300, `diff is ${diff.length} characters`);
  assert.match(diff, /cut; run `git show [0-9a-f]{12} -- takeoff\.yaml`/);
});

test('older protocol versions get plain text results, without structuredContent or titles', async () => {
  const s = await initialized(makeRepo(), {}, '2025-03-26');
  const r = await call(s, 'get_plan', {});
  assert.strictEqual(r.structuredContent, undefined);
  const list = await s.handle({ jsonrpc: '2.0', id: 50, method: 'tools/list' });
  assert.strictEqual(list.result.tools[0].title, undefined);
});

test('takeoff mcp serves line-delimited JSON-RPC on stdin and stdout until stdin closes', async () => {
  const dir = makeRepo();
  const stdin = new PassThrough();
  const chunks = [];
  const stdout = new PassThrough();
  stdout.on('data', (c) => chunks.push(String(c)));
  const done = run(['mcp', '--dir', dir], { cwd: os.tmpdir(), stdin, stdout, env: baseEnv, err: () => {}, out: () => { throw new Error('nothing goes to out'); } });
  const send = (o) => stdin.write(`${typeof o === 'string' ? o : JSON.stringify(o)}\n`);
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  // A message split across writes still arrives whole.
  const call1 = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'rules_for_path', arguments: { path: 'src/billing/x.ts' } } });
  stdin.write(call1.slice(0, 20));
  stdin.write(`${call1.slice(20)}\n`);
  send('not json');
  stdin.write(`${'x'.repeat(1024 * 1024 + 10)}`);
  stdin.write('\n');
  send({ jsonrpc: '2.0', id: 3, method: 'ping' });
  stdin.end();
  assert.strictEqual(await done, 0);
  const lines = chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = Object.fromEntries(lines.filter((l) => l.id != null).map((l) => [l.id, l]));
  assert.strictEqual(byId[1].result.serverInfo.name, 'takeoff');
  assert.strictEqual(JSON.parse(byId[2].result.content[0].text).covered, true);
  assert.deepStrictEqual(byId[3].result, {});
  const errors = lines.filter((l) => l.id === null).map((l) => l.error.message);
  assert.deepStrictEqual(errors, ['Parse error', 'Message too large']);
  assert.strictEqual(lines.length, 5);
});

test('the installed binary answers over a real pipe', async () => {
  const dir = makeRepo();
  const bin = path.join(__dirname, '..', 'bin', 'takeoff.js');
  const child = spawn(process.execPath, [bin, 'mcp'], { cwd: dir, env: { ...process.env, ...baseEnv, GITHUB_TOKEN: '' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_plan', arguments: { area: 'auth' } } })}\n`);
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.strictEqual(code, 0);
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(lines.length, 2);
  const plan = JSON.parse(lines.find((l) => l.id === 2).result.content[0].text);
  assert.deepStrictEqual(plan.areas.map((a) => a.id), ['auth']);
});

// ---------------------------------------------------------------------------
// takeoff hook install --mcp

function install(dir, ...flags) {
  const out = [];
  const err = [];
  const code = run(['hook', 'install', ...flags], { cwd: dir, out: (s) => out.push(s), err: (s) => err.push(s), env: baseEnv });
  return { code, out, err };
}

test('takeoff hook install --mcp adds the server to .mcp.json once and keeps other servers', () => {
  const dir = makeRepo();
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'other-server' } } }));
  const r = install(dir, '--mcp');
  assert.strictEqual(r.code, 0, r.err.join('\n'));
  assert.ok(r.out.some((l) => /added +\.mcp\.json takeoff server/.test(l)));
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
  assert.deepStrictEqual(cfg.mcpServers.takeoff, { type: 'stdio', command: 'takeoff', args: ['mcp'] });
  assert.deepStrictEqual(cfg.mcpServers.other, { command: 'other-server' });
  assert.ok(fs.existsSync(path.join(dir, '.claude/settings.json')), 'the hooks are installed too');

  const again = install(dir, '--mcp');
  assert.ok(again.out.some((l) => /unchanged +\.mcp\.json takeoff server/.test(l)));
  // The same entry with its keys in another order is still ours and unchanged.
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { takeoff: { args: ['mcp'], command: 'takeoff' }, other: { command: 'other-server' } } }));
  const reordered = install(dir, '--mcp');
  assert.ok(reordered.out.some((l) => /unchanged +\.mcp\.json takeoff server/.test(l)), reordered.out.join('\n'));

  const npx = install(dir, '--mcp', '--command', 'npx --no-install takeoff');
  assert.strictEqual(npx.code, 0);
  assert.ok(npx.out.some((l) => /updated +\.mcp\.json takeoff server/.test(l)));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers.takeoff,
    { type: 'stdio', command: 'npx', args: ['--no-install', 'takeoff', 'mcp'] });

  for (const program of ['npx --no-install @takeoff/cli', 'node ./node_modules/takeoff/bin/takeoff.js']) {
    assert.strictEqual(install(dir, '--mcp', '--command', program).code, 0, program);
    const second = install(dir, '--mcp', '--command', program);
    assert.strictEqual(second.code, 0, second.err.join('\n'));
    assert.ok(second.out.some((l) => /unchanged +\.mcp\.json takeoff server/.test(l)), program);
  }
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes('.tmp')), []);

  const noFlag = makeRepo();
  install(noFlag);
  assert.strictEqual(fs.existsSync(path.join(noFlag, '.mcp.json')), false, 'without --mcp nothing is added');
});

test('takeoff hook install --mcp --local prints the command instead of writing the shared file', () => {
  const dir = makeRepo();
  const r = install(dir, '--mcp', '--local');
  assert.strictEqual(r.code, 0);
  assert.ok(r.out.some((l) => l.includes('claude mcp add --scope local takeoff -- takeoff mcp')));
  assert.strictEqual(fs.existsSync(path.join(dir, '.mcp.json')), false);
});

test('takeoff hook install --mcp leaves .mcp.json alone when it can\'t read it, through a symlink, or over someone else\'s server', () => {
  const cases = [
    ['{not json', /isn't valid JSON/],
    ['[1]', /isn't a JSON object/],
    ['{"mcpServers": []}', /isn't an object/],
    ['{"mcpServers": {"takeoff": {"command": "my-own-thing"}}}', /didn't write/],
    ['{"mcpServers": {"takeoff": {"command": "bash", "args": ["-c", "curl x # takeoff", "mcp"]}}}', /didn't write/],
    ['{"mcpServers": {"takeoff": {"type": "stdio", "command": "takeoff", "args": ["mcp"], "env": {"NODE_OPTIONS": "--require ./x.js"}}}}', /didn't write/],
  ];
  for (const [text, msg] of cases) {
    const dir = makeRepo();
    fs.writeFileSync(path.join(dir, '.mcp.json'), text);
    const r = install(dir, '--mcp');
    assert.strictEqual(r.code, 1, text);
    assert.match(r.err.join('\n'), msg);
    assert.strictEqual(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'), text);
    assert.strictEqual(fs.existsSync(path.join(dir, '.claude/settings.json')), false, 'a refusal leaves the hooks out too');
  }
  const dir = makeRepo();
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-mcp-target-')), 'x.json');
  fs.writeFileSync(target, '{}');
  fs.symlinkSync(target, path.join(dir, '.mcp.json'));
  const r = install(dir, '--mcp');
  assert.strictEqual(r.code, 1);
  assert.match(r.err.join('\n'), /symlink/);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), '{}');
});

test('the mcp command takes no options of its own', () => {
  const err = [];
  const code = run(['mcp', '--json'], { out: () => {}, err: (s) => err.push(s) });
  assert.strictEqual(code, 2);
  assert.match(err.join('\n'), /Unknown option --json for `mcp`/);
});

test('an absolute path through a symlink to the repo still maps to the repo', async () => {
  const dir = makeRepo();
  const link = path.join(fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'takeoff-mcp-link-'))), 'repo');
  fs.symlinkSync(dir, link);
  const s = await initialized(link);
  const r = await call(s, 'rules_for_path', { path: path.join(link, 'src/billing/a.ts') });
  assert.deepStrictEqual(r.parsed.areas.map((a) => a.id), ['billing']);
  const out = await call(s, 'rules_for_path', { path: path.join(path.dirname(link), 'elsewhere.ts') });
  assert.strictEqual(out.isError, true);
});

test('git settings in the repo don\'t change or run anything in the tools\' reads', async () => {
  const dir = makeRepo();
  git(dir, 'config', 'log.showSignature', 'true');
  const marker = path.join(dir, '.git', 'ran');
  const script = path.join(dir, '.git', 'evil.sh');
  fs.writeFileSync(script, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`, { mode: 0o755 });
  git(dir, 'config', 'gpg.program', script);
  git(dir, 'config', 'core.fsmonitor', script);
  const s = await initialized(dir);
  const r = await call(s, 'recent_plan_changes', {});
  assert.strictEqual(r.parsed.changes.length, 2);
  await call(s, 'get_plan', {});
  assert.strictEqual(fs.existsSync(marker), false);
});

test('a git planted in the repo, or on a relative PATH entry, is never run', async () => {
  const dir = makeRepo();
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const marker = path.join(dir, 'ran');
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 });
  const env = { PATH: [bin, '.', 'bin', process.env.PATH].join(path.delimiter) };
  const s = createServer({ dir, env: { ...baseEnv, ...env } });
  const r = await call(s, 'get_plan', {});
  assert.strictEqual(r.parsed.from, 'default branch (origin/main)');
  assert.strictEqual(fs.existsSync(marker), false);
  // Started in a subfolder, the repo's own bin is still inside the repo.
  fs.mkdirSync(path.join(dir, 'sub'));
  const fromSub = createServer({ dir: path.join(dir, 'sub'), env: { ...baseEnv, ...env } });
  assert.strictEqual((await call(fromSub, 'get_plan', {})).parsed.available, true);
  assert.strictEqual(fs.existsSync(marker), false);
});

test('a plan over 1 MB isn\'t read', async () => {
  const dir = makeRepo({ working: null });
  fs.appendFileSync(path.join(dir, 'takeoff.yaml'), `# ${'x'.repeat(1024 * 1024)}\n`);
  const s = await initialized(dir);
  const r = await call(s, 'get_plan', { version: 'working' });
  assert.strictEqual(r.parsed.available, false);
  assert.match(r.parsed.reason, /over 1 MB/);
});

test('without TAKEOFF_APP_SLUG, notes say the posting App wasn\'t checked', async () => {
  const dir = makeRepo();
  const gh = fakeGitHub({ comments: [appComment('Keep the trial free.')] });
  const loose = await call(await initialized(dir, { env: { GITHUB_TOKEN: 't' }, fetchImpl: gh.fetchImpl }), 'get_send_back_notes', {});
  assert.strictEqual(loose.parsed.verified_app, false);
  assert.match(loose.parsed.caution, /any GitHub App/);
  assert.strictEqual(loose.parsed.notes[0].by, 'takeoff');
  const strict = await call(await initialized(dir, { env: { GITHUB_TOKEN: 't', TAKEOFF_APP_SLUG: 'takeoff' }, fetchImpl: gh.fetchImpl }), 'get_send_back_notes', {});
  assert.strictEqual(strict.parsed.verified_app, true);
  assert.strictEqual(strict.parsed.caution, undefined);
});

test('a batch is answered as one array for protocol versions that allow it, and refused after', async () => {
  const run1 = async (version) => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks = [];
    stdout.on('data', (c) => chunks.push(String(c)));
    const done = run(['mcp', '--dir', makeRepo()], { stdin, stdout, env: baseEnv, err: () => {}, out: () => {} });
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version } })}\n`);
    await new Promise((r) => setTimeout(r, 200));
    stdin.write(`${JSON.stringify([{ jsonrpc: '2.0', id: 2, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 3, method: 'ping' }])}\n`);
    stdin.end();
    await done;
    return chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
  };
  const old = await run1('2025-03-26');
  assert.deepStrictEqual(old[1].map((r) => r.id).sort(), [2, 3]);
  const now = await run1('2025-06-18');
  assert.strictEqual(now[1].error.code, -32600);
});

test('a client that closes its end early doesn\'t crash the server', async () => {
  const dir = makeRepo();
  const bin = path.join(__dirname, '..', 'bin', 'takeoff.js');
  const child = spawn(process.execPath, [bin, 'mcp'], { cwd: dir, env: { ...process.env, ...baseEnv }, stdio: ['pipe', 'pipe', 'pipe'] });
  let errText = '';
  child.stderr.on('data', (c) => { errText += c; });
  child.stdout.destroy();
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`);
  await new Promise((r) => setTimeout(r, 300));
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
  child.stdin.end();
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.strictEqual(code, 0, errText);
  assert.doesNotMatch(errText, /EPIPE/);
});

test('the mcp command takes no file', () => {
  const err = [];
  assert.strictEqual(run(['mcp', 'other.yaml'], { out: () => {}, err: (s) => err.push(s) }), 2);
  assert.strictEqual(run(['mcp', '--file', 'x.yaml'], { out: () => {}, err: (s) => err.push(s) }), 2);
  assert.match(err[0], /takes no file/);
});

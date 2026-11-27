const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// No network and no model, anywhere in these tests.
const realFetch = global.fetch;
const fetchCalls = [];
global.fetch = async (url) => { fetchCalls.push(String(url)); throw new Error('no network in tests'); };

const { createAskTools, DEFINITIONS, TOOL_NAMES } = require('./index');
const { normalizePath, likePrefixOf, searchTerms } = require('./safety');
const { prepareText } = require('../../code-index/filter');

const FIXTURES = path.join(__dirname, '../../verdict/fixtures');
const YAML = fs.readFileSync(path.join(FIXTURES, 'takeoff.yaml'), 'utf8');
const AWS = 'AKIA' + 'Q'.repeat(16);

// What the stored index would hold, run through the same filter the index uses.
function storedFiles(raw) {
  const out = new Map();
  for (const [p, text] of Object.entries(raw)) {
    const size = Buffer.byteLength(text);
    const r = prepareText(p, Buffer.from(text), { size });
    out.set(p, { path: p, content: r.content == null ? null : r.content, skipped_reason: r.skippedReason || null, size_bytes: size, redactions: r.redactions || 0 });
  }
  return out;
}

const RAW = {
  'takeoff.yaml': YAML,
  'src/billing/charge.js': "import { stripe } from './stripe';\nexport function chargeCard(id) {\n  return stripe.charges.create({ customer: id });\n}\n",
  'src/billing/stripe.js': `const key = "${AWS}";\nexport const stripe = makeStripe(key);\n`,
  'src/trips/trip.js': "export class Trip {\n  constructor(a, b) { this.travellers = [a, b]; }\n}\n",
  'src/pages/checkout.jsx': "import { chargeCard } from '../billing/charge';\nexport default function Checkout() { return chargeCard('x'); }\n",
  '.env': 'STRIPE_SECRET=sk_live_' + 'x'.repeat(30) + '\n',
  'big/data.json': 'x'.repeat(5 * 1024 * 1024),
  'docs/long.md': Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n') + '\n',
};

// A LIKE pattern as the code index uses it, in JS.
const likeOk = (pat, p, at) => {
  if (!pat) return true;
  const lit = pat.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1');
  return at === 'start' ? p.startsWith(lit) : p.endsWith(lit);
};

function fakeIndex({ status = 'ready', sha = 'c'.repeat(40), raw = RAW, rows = [] } = {}) {
  const files = storedFiles(raw);
  // Rows put in as-is, as an index built before a rule existed would hold them.
  for (const r of rows) files.set(r.path, { redactions: 0, size_bytes: Buffer.byteLength(r.content || ''), skipped_reason: null, ...r });
  const symbols = [
    { path: 'src/billing/charge.js', symbol: 'chargeCard', kind: 'function', line: 2 },
    { path: 'src/trips/trip.js', symbol: 'Trip', kind: 'class', line: 1 },
  ];
  const imports = [['src/billing/charge.js', 'src/billing/stripe.js'], ['src/pages/checkout.jsx', 'src/billing/charge.js']];
  const calls = [];
  return {
    calls,
    async getRepo() { calls.push('getRepo'); return status ? { status, indexed_sha: status === 'building' ? null : sha } : null; },
    async readFile(_pid, p) { calls.push(['readFile', p]); return files.get(p) || null; },
    async search(_pid, { terms, likePrefix, likeSuffix, limit = 500 }) {
      calls.push(['search', terms, likePrefix, likeSuffix]);
      const tokens = (t) => t.toLowerCase().split(/[^a-z0-9_]+/);
      const hit = (f, all) => {
        const toks = tokens(`${f.path} ${f.content}`);
        const ok = (t) => toks.some((x) => x.startsWith(t));
        return all ? terms.every(ok) : terms.some(ok);
      };
      const pool = [...files.values()].filter((f) => f.content != null && likeOk(likePrefix, f.path, 'start') && likeOk(likeSuffix, f.path, 'end'));
      const all = pool.filter((f) => hit(f, true));
      if (all.length || terms.length === 1) return all.slice(0, limit).map((f) => ({ path: f.path, matchedAll: true }));
      return pool.filter((f) => hit(f, false)).slice(0, limit).map((f) => ({ path: f.path, matchedAll: false }));
    },
    async contents(_pid, paths) {
      calls.push(['contents', paths]);
      return paths.map((p) => files.get(p)).filter((f) => f && f.content != null);
    },
    async findSymbols(_pid, name) {
      return symbols.filter((s) => s.symbol.toLowerCase().includes(name.toLowerCase()))
        .map((s) => ({ ...s, exact: s.symbol.toLowerCase() === name.toLowerCase() }));
    },
    async listPathsUnder(_pid, { likePrefix, likeSuffix, limit = 20000 }) {
      calls.push(['list', likePrefix, likeSuffix]);
      return [...files.values()].filter((f) => likeOk(likePrefix, f.path, 'start') && likeOk(likeSuffix, f.path, 'end'))
        .sort((a, b) => a.path.localeCompare(b.path)).slice(0, limit);
    },
    async importersOf(_pid, p) { return imports.filter(([, to]) => to === p).map(([from]) => from); },
  };
}

function fakeGithub({ yaml = YAML, fail = false, commits = [] } = {}) {
  const calls = [];
  const maybe = () => { if (fail) throw Object.assign(new Error('GitHub API 404'), { status: 404 }); };
  return {
    calls,
    async fetchRepoMeta() { calls.push('meta'); maybe(); return { default_branch: 'main' }; },
    async fetchBranch() { calls.push('branch'); maybe(); return { commit: { sha: 'g'.repeat(40) } }; },
    async fetchFileTextOrNull() { calls.push('file'); maybe(); return yaml; },
    async fetchCommits(_o, _r, opts) { calls.push(['commits', opts]); maybe(); return commits; },
  };
}

const project = { id: 'p1', owner: 'acme', repo: 'delta', user_id: 'u-owner', github_installation_id: 42 };

function setup({ index = fakeIndex(), gh = fakeGithub(), rows = {} } = {}) {
  const built = [];
  const deps = {
    codeIndex: index,
    clientFor: () => gh,
    ensureBuilt: async (p) => { built.push(p.id); },
    projectMembers: { list: async () => rows.members || [
      { user_id: 'u-owner', display_name: 'Samyak', email: 'samyak@example.com', labels: ['creator'] },
      { user_id: 'u2', display_name: 'Dev', email: 'dev@example.com', labels: ['builder'] },
    ] },
    agreements: { list: async () => rows.agreements || [] },
    agreementVotes: { listFor: async () => rows.votes || [] },
    driftDecisions: {
      listRecent: async () => rows.decisions || [],
      listForPr: async (_p, _r, n) => (rows.decisions || []).filter((d) => Number(d.pr_number) === n),
    },
    prChecks: {
      latestPerPr: async (scope) => { assert.strictEqual(scope.projectId, 'p1'); return rows.checks || []; },
      latestForPr: async ({ prNumber, projectId }) => { assert.strictEqual(projectId, 'p1'); return (rows.checks || []).find((c) => c.pr_number === prNumber) || null; },
    },
    intentStatements: { findConfirmedByProjectId: async () => rows.statements || [] },
  };
  const tools = createAskTools({ project, deps, now: () => Date.parse('2026-11-27T12:00:00Z') });
  return { tools, deps, index, gh, built };
}

test('there are thirteen tools, each with a schema, and none of them writes', () => {
  assert.strictEqual(DEFINITIONS.length, 13);
  assert.deepStrictEqual(TOOL_NAMES, ['get_plan', 'rules_for_path', 'get_agreements', 'get_decisions', 'get_pr_checks',
    'get_people', 'get_capabilities', 'search_code', 'find_symbol', 'list_files', 'read_file', 'find_usages', 'recent_changes']);
  for (const d of DEFINITIONS) {
    assert.strictEqual(d.input_schema.type, 'object');
    assert.ok(d.description.length > 20);
    assert.ok(!/create|update|delete|write|commit|post|vote/.test(d.name));
  }
});

test('ownerless projects are refused', () => {
  assert.throws(() => createAskTools({ project: { ...project, user_id: null }, deps: {} }), /no owner/);
});

test('get_plan reads the stored plan with stable rule ids, and calls GitHub not at all', async () => {
  const { tools, gh } = setup();
  const { ok, result } = await tools.call('get_plan', {});
  assert.ok(ok);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.product.name, 'Delta-V');
  const billing = result.areas.find((a) => a.id === 'billing');
  assert.strictEqual(billing.rules[0].source_id, 'plan@cccccccccccc#billing.rules[0]');
  assert.strictEqual(billing.never[0].text, 'Never store card numbers.');
  assert.strictEqual(result.agreements[0].source_id, 'plan@cccccccccccc#agreements[agr_2026_11_24_annual_plan]');
  assert.deepStrictEqual(gh.calls, []);
  const src = tools.sources.get('plan@cccccccccccc#billing.rules[0]');
  assert.strictEqual(src.text, 'Stripe holds all billing data; we store only Stripe IDs.');

  const one = (await tools.call('get_plan', { area: 'Trips' })).result;
  assert.deepStrictEqual(one.areas.map((a) => a.id), ['trips']);
  assert.deepStrictEqual(one.agreements, []);
  const none = (await tools.call('get_plan', { area: 'nope' })).result;
  assert.strictEqual(none.found, false);
  assert.match(none.message, /billing, trips/);
});

test('a stored plan with hidden text is read from GitHub at the same commit; a skipped one is unreadable, not missing', async () => {
  const yaml = YAML.replace('rules:\n      - "A trip', 'rules:\n      - id: two_travellers\n        text: "A trip').replace('two travellers."', 'two travellers."');
  const shaSeen = [];
  const gh = fakeGithub({ yaml });
  gh.fetchFileTextOrNull = async (_o, _r, _f, sha) => { gh.calls.push('file'); shaSeen.push(sha); return yaml; };
  const index = fakeIndex({ rows: [{ path: 'takeoff.yaml', content: YAML.replace('Stripe IDs', '[redacted secret]'), redactions: 1 }] });
  const { tools } = setup({ index, gh });
  const r = (await tools.call('get_plan', {})).result;
  assert.deepStrictEqual(gh.calls, ['file']);
  assert.deepStrictEqual(shaSeen, ['c'.repeat(40)]);
  assert.strictEqual(r.sha, 'c'.repeat(40));
  assert.match(r.areas[0].rules[0].text, /Stripe IDs/);
  assert.strictEqual(r.areas.find((a) => a.id === 'trips').rules[0].source_id, 'plan@cccccccccccc#trips.rules.two_travellers', 'a rule’s own id is used');

  const failing = setup({ index: fakeIndex({ rows: [{ path: 'takeoff.yaml', content: YAML.replace('Stripe IDs', '[redacted secret]'), redactions: 1 }] }), gh: fakeGithub({ fail: true }) });
  const fb = (await failing.tools.call('get_plan', {})).result;
  assert.strictEqual(fb.available, true);
  assert.match(fb.note, /hidden/);

  const skipped = setup({ index: fakeIndex({ rows: [{ path: 'takeoff.yaml', content: null, skipped_reason: 'too_large' }] }), gh: fakeGithub({ fail: true }) });
  assert.match((await skipped.tools.call('get_plan', {})).result.reason, /can’t read this repo/);
});

test('tool calls made side by side share one read of the index and the plan', async () => {
  const index = fakeIndex();
  const { tools } = setup({ index });
  await Promise.all([
    tools.call('get_plan', {}), tools.call('rules_for_path', { path: 'src/a.js' }),
    tools.call('search_code', { query: 'chargeCard' }), tools.call('find_symbol', { name: 'Trip' }),
  ]);
  assert.strictEqual(index.calls.filter((c) => c === 'getRepo').length, 2, 'once for the code index, once for the plan');
  assert.strictEqual(index.calls.filter((c) => Array.isArray(c) && c[0] === 'readFile' && c[1] === 'takeoff.yaml').length, 1);
});

test('with no usable index the plan comes from GitHub; without access, plan questions say so and the rest still work', async () => {
  let s = setup({ index: fakeIndex({ status: null }) });
  let r = (await s.tools.call('get_plan', {})).result;
  assert.strictEqual(r.sha, 'g'.repeat(40));
  assert.deepStrictEqual(s.gh.calls, ['meta', 'branch', 'file']);

  s = setup({
    index: fakeIndex({ status: null }),
    gh: fakeGithub({ fail: true }),
    rows: { agreements: [{ id: 'agr_x', text: 'Refunds within 30 days.', status: 'accepted', proposed_by: 'u2', area_id: 'billing' }] },
  });
  r = (await s.tools.call('get_plan', {})).result;
  assert.strictEqual(r.available, false);
  assert.match(r.reason, /can’t read this repo/);
  const agr = (await s.tools.call('get_agreements', {})).result;
  assert.strictEqual(agr.agreements[0].text, 'Refunds within 30 days.');
  const code = (await s.tools.call('search_code', { query: 'charge' })).result;
  assert.strictEqual(code.available, false);
  assert.deepStrictEqual(s.built, ['p1'], 'a build is started for next time');
});

test('a behind index reads the plan live, falling back to the stored one marked stale', async () => {
  let s = setup({ index: fakeIndex({ status: 'behind' }) });
  assert.strictEqual((await s.tools.call('get_plan', {})).result.sha, 'g'.repeat(40));
  s = setup({ index: fakeIndex({ status: 'behind' }), gh: fakeGithub({ fail: true }) });
  const r = (await s.tools.call('get_plan', {})).result;
  assert.strictEqual(r.sha, 'c'.repeat(40));
  assert.strictEqual(r.stale, true);
});

test('a missing or broken takeoff.yaml is reported, never guessed at', async () => {
  let s = setup({ index: fakeIndex({ status: null }), gh: fakeGithub({ yaml: null }) });
  assert.match((await s.tools.call('get_plan', {})).result.reason, /no takeoff.yaml/);
  s = setup({ index: fakeIndex({ status: null }), gh: fakeGithub({ yaml: 'version: 2\nareas: [oops' }) });
  assert.match((await s.tools.call('get_plan', {})).result.reason, /has errors/);
});

test('rules_for_path finds the areas whose paths cover a file', async () => {
  const { tools } = setup();
  // Worked out by hand from the fixture plan's paths.
  const expected = {
    'src/billing/charge.js': ['billing'],
    'src/billing/deep/nested/x.ts': ['billing'],
    'src/pages/checkout.jsx': ['billing'],
    'src/pages/checkoutSuccess.tsx': ['billing'],
    'src/pages/home.jsx': [],
    'src/trips/trip.js': ['trips'],
    'src/tripsx/a.js': [],
    'README.md': [],
  };
  for (const [p, areas] of Object.entries(expected)) {
    const { result } = await tools.call('rules_for_path', { path: p });
    assert.deepStrictEqual(result.areas.map((a) => a.id), areas, p);
    assert.strictEqual(result.covered, areas.length > 0, p);
    // Product-wide agreements always apply; area ones only with their area.
    assert.deepStrictEqual(result.agreements.map((g) => g.id), areas.includes('billing') ? ['agr_2026_11_24_annual_plan'] : [], p);
  }
  const r = (await tools.call('rules_for_path', { path: './src/pages/checkout.jsx' })).result;
  assert.deepStrictEqual(r.areas.map((a) => a.id), ['billing']);
  assert.ok(r.sources.includes('plan@cccccccccccc#billing.never[0]'));
});

test('paths are normalized, and ../, absolute paths and odd characters are refused', async () => {
  assert.strictEqual(normalizePath('./src//a.js'), 'src/a.js');
  for (const bad of ['../etc/passwd', 'src/../../x', '/etc/passwd', 'C:\\x', '~/x', 'a\\b', 'a\u0000b', '', '  ']) {
    assert.throws(() => normalizePath(bad), undefined, bad);
  }
  const { tools } = setup();
  for (const name of ['read_file', 'rules_for_path', 'find_usages']) {
    const r = await tools.call(name, { path: '../other-repo/secret.js' });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /outside the repo/);
  }
  assert.strictEqual((await tools.call('list_files', { path_glob: '../**' })).ok, false);
  assert.deepStrictEqual((await tools.call('list_files', { path_glob: 'src//billing/*.js' })).result.files.map((f) => f.path), ['src/billing/charge.js', 'src/billing/stripe.js']);
  assert.strictEqual(likePrefixOf('src/a_b%/**'), 'src/a\\_b\\%/%');
  assert.deepStrictEqual(searchTerms('Charge card, chargeCard!'), ['charge', 'card', 'chargecard']);
});

test('.env, a planted AWS key and a 5 MB file are refused or redacted', async () => {
  const { tools } = setup();
  const env = (await tools.call('read_file', { path: '.env' })).result;
  assert.strictEqual(env.readable, false);
  assert.match(env.reason, /keys or credentials/);
  const key = (await tools.call('read_file', { path: 'src/billing/stripe.js' })).result;
  assert.ok(!key.text.includes(AWS));
  assert.match(key.text, /redacted/);
  assert.strictEqual(key.secrets_hidden, true);
  const big = (await tools.call('read_file', { path: 'big/data.json' })).result;
  assert.strictEqual(big.readable, false);
  assert.match(big.reason, /too large/);
  // Nor do they turn up in a search or a listing as readable.
  const search = (await tools.call('search_code', { query: 'STRIPE_SECRET' })).result;
  assert.deepStrictEqual(search.hits, []);
  const all = JSON.stringify(await tools.call('search_code', { query: 'key' }));
  assert.ok(!all.includes(AWS));
  const listing = (await tools.call('list_files', {})).result.files;
  assert.strictEqual(listing.find((f) => f.path === '.env'), undefined, 'credential files are left out of listings');
  assert.strictEqual(listing.find((f) => f.path === 'big/data.json').readable, false);
});

test('text an older index kept is still refused: a key block, a Kubernetes Secret, a credential path', async () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----';
  const rows = [
    { path: 'src/old/notes.txt', content: Array.from({ length: 50 }, (_, i) => `note ${i} chargeCard`).join('\n') + `\n${pem}\nMIIE\n` },
    { path: 'deploy/secret.yaml', content: 'apiVersion: v1\nkind: Secret\ndata:\n  chargeCard: eHl6\n' },
    { path: 'config/.env.production', content: 'chargeCard=1\n' },
  ];
  const { tools } = setup({ index: fakeIndex({ rows }) });
  const slice = (await tools.call('read_file', { path: 'src/old/notes.txt', start: 1, end: 3 })).result;
  assert.strictEqual(slice.readable, false, 'a slice before the key block is refused too');
  assert.match(slice.reason, /private key/);
  assert.strictEqual((await tools.call('read_file', { path: 'deploy/secret.yaml' })).result.readable, false);
  assert.strictEqual((await tools.call('read_file', { path: 'config/.env.production' })).result.readable, false);
  assert.strictEqual((await tools.call('find_usages', { path: 'config/.env.production' })).result.readable, false);
  const s = (await tools.call('search_code', { query: 'chargeCard' })).result;
  assert.deepStrictEqual(s.hits.map((h) => h.path).sort(), ['src/billing/charge.js', 'src/pages/checkout.jsx']);
  assert.ok(!JSON.stringify(s).includes('BEGIN'));
  assert.ok(!(await tools.call('list_files', { path_glob: 'config/**' })).result.files.length);
});

test('a glob with no fixed start still finds files ranked past the first rows', async () => {
  const raw = {};
  for (let i = 0; i < 700; i += 1) raw[`src/gen/f${String(i).padStart(3, '0')}.js`] = 'export const widget = 1;\n';
  raw['db/migrations/001_widget.sql'] = 'CREATE TABLE widget (id int);\n';
  const index = fakeIndex({ raw });
  const { tools } = setup({ index });
  const s = (await tools.call('search_code', { query: 'widget', path_glob: '**/*.sql' })).result;
  assert.deepStrictEqual(s.hits.map((h) => h.path), ['db/migrations/001_widget.sql']);
  assert.strictEqual(s.more, false);
  assert.ok(index.calls.some((c) => c[0] === 'search' && c[3] === '%.sql'));
  const l = (await tools.call('list_files', { path_glob: '**/*.sql' })).result;
  assert.deepStrictEqual(l.files.map((f) => f.path), ['db/migrations/001_widget.sql']);
  const all = (await tools.call('search_code', { query: 'widget' })).result;
  assert.strictEqual(all.hits.length, 15);
  assert.strictEqual(all.more, true);
  // A pattern SQL can't narrow says the search wasn't complete.
  const braced = (await tools.call('search_code', { query: 'widget', path_glob: '{db,x}/**' })).result;
  assert.deepStrictEqual(braced.hits, []);
  assert.strictEqual(braced.more, true);
  assert.match(braced.note, /not all of them were checked/);
});

test('the SQL hints from a glob never leave out a path the glob matches', () => {
  const { likeSuffixOf } = require('./safety');
  const { globMatches } = require('../../verdict/globs');
  const pats = ['{src,lib}/billing', '{a/*,b}.js', 'a]b/c', 'a}/c', '**/*.sql', 'src/**/index.js', '**/*.{js,ts}',
    '*.{test,spec}.js', 'src/', 'src/*', 'a[bc]d/*x', 'a/[x', 'src/**', '**/a_b%.js', 'x/*/y/z.md', '{a,b/*}/c.js', '[ab]', '**'];
  const paths = ['src/billing/x.js', 'b.js/x', 'a]b/c/d.js', 'a}/c/d.js', 'x.sql', 'db/m/1.sql', 'src/index.js', 'src/a/index.js',
    'a/b.ts', 'a.js', 'a.spec.js', 'src/a/b', 'src/a', 'abd/zx', 'a/[x', 'q/a_b%.js', 'x/k/y/z.md', 'a/c.js', 'b/q/c.js', 'a', 'b'];
  const unlike = (pat) => pat.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1');
  for (const g of pats) {
    const pre = likePrefixOf(g);
    const suf = likeSuffixOf(g);
    for (const p of paths) {
      if (!globMatches(g, p)) continue;
      assert.ok(!pre || p.startsWith(unlike(pre)), `${g} prefix drops ${p}`);
      assert.ok(!suf || p.endsWith(unlike(suf)), `${g} suffix drops ${p}`);
    }
  }
  assert.strictEqual(likeSuffixOf('**/*.sql'), '%.sql');
  assert.strictEqual(likeSuffixOf('{src,lib}/billing'), null, 'a pattern with no wildcard covers everything under it');
});

test('read_file returns numbered lines within the caps, and at most six files a question', async () => {
  const { tools } = setup();
  const r = (await tools.call('read_file', { path: 'docs/long.md' })).result;
  assert.strictEqual(r.lines, '1-400');
  assert.strictEqual(r.total_lines, 1000);
  assert.strictEqual(r.truncated, true);
  assert.ok(r.text.startsWith('1\tline 1\n2\tline 2'));
  assert.strictEqual(r.source_id, 'code:docs/long.md@cccccccccccc:L1-400');
  const src = tools.sources.get(r.source_id);
  assert.deepStrictEqual({ ...src, text: undefined }, { kind: 'code', path: 'docs/long.md', sha: 'c'.repeat(40), start: 1, end: 400, text: undefined });
  assert.ok(src.text.startsWith('line 1\nline 2'), 'the source keeps the text the model was shown');
  assert.strictEqual(r.secrets_hidden, undefined);
  const mid = (await tools.call('read_file', { path: 'docs/long.md', start: 990, end: 2000 })).result;
  assert.strictEqual(mid.lines, '990-1000');
  for (let i = 0; i < 4; i += 1) assert.ok((await tools.call('read_file', { path: 'src/trips/trip.js' })).result.text);
  const seventh = (await tools.call('read_file', { path: 'src/trips/trip.js' })).result;
  assert.strictEqual(seventh.readable, false);
  assert.match(seventh.reason, /already read 6 files/);
  const missing = (await tools.call('read_file', { path: 'nope.js' })).result;
  assert.strictEqual(missing.exists, false);
});

test('read_file keeps to 24 KB on long lines', async () => {
  const raw = { 'src/wide.js': Array.from({ length: 300 }, () => 'a'.repeat(199)).join('\n') + '\n' };
  const { tools } = setup({ index: fakeIndex({ raw }) });
  const r = (await tools.call('read_file', { path: 'src/wide.js' })).result;
  const [a, b] = r.lines.split('-').map(Number);
  assert.strictEqual(a, 1);
  assert.ok((b - a + 1) * 200 <= 24 * 1024);
  assert.ok(b < 300);
});

test('code tools read only the stored index: search, symbols, listing and usages, with no GitHub calls', async () => {
  const { tools, gh } = setup();
  const s = (await tools.call('search_code', { query: 'chargeCard' })).result;
  assert.strictEqual(s.code_as_of, 'c'.repeat(40));
  assert.deepStrictEqual(s.hits.map((h) => h.path).sort(), ['src/billing/charge.js', 'src/pages/checkout.jsx']);
  const h = s.hits.find((x) => x.path === 'src/billing/charge.js');
  assert.match(h.snippet, /chargeCard/);
  assert.ok(h.snippet.length <= 300);
  assert.match(h.source_id, /^code:src\/billing\/charge\.js@cccccccccccc:L\d+-\d+$/);
  const scoped = (await tools.call('search_code', { query: 'charge', path_glob: 'src/pages/**' })).result;
  assert.deepStrictEqual(scoped.hits.map((x) => x.path), ['src/pages/checkout.jsx']);
  const some = (await tools.call('search_code', { query: 'travellers zzzunknown' })).result;
  assert.match(some.match, /some words/);

  const sym = (await tools.call('find_symbol', { name: 'chargecard' })).result;
  assert.deepStrictEqual(sym.found.map((f) => [f.path, f.line, f.exact]), [['src/billing/charge.js', 2, true]]);
  const files = (await tools.call('list_files', { path_glob: 'src/billing/*.js' })).result;
  assert.deepStrictEqual(files.files.map((f) => f.path), ['src/billing/charge.js', 'src/billing/stripe.js']);
  const uses = (await tools.call('find_usages', { path: 'src/billing/charge.js' })).result;
  assert.deepStrictEqual(uses.imported_by.map((u) => u.path), ['src/pages/checkout.jsx']);
  assert.deepStrictEqual(gh.calls, []);
  assert.deepStrictEqual(fetchCalls, []);
});

test('a behind index still answers code questions and says so; a too-large repo says it can’t', async () => {
  let s = setup({ index: fakeIndex({ status: 'behind' }) });
  const r = (await s.tools.call('find_symbol', { name: 'Trip' })).result;
  assert.strictEqual(r.available, true);
  assert.match(r.note, /may not be in the stored code/);
  s = setup({ index: fakeIndex({ status: 'too_large' }) });
  assert.match((await s.tools.call('list_files', {})).result.reason, /too large/);
});

test('agreements, decisions and PR checks come with names, not ids, and stable source ids', async () => {
  const rows = {
    agreements: [
      { id: 'agr_a', area_id: 'billing', text: 'Annual plan at 20% off.', status: 'accepted', proposed_by: 'u2', decided_by: 'u-owner', decided_via: 'everyone_agreed', commit_state: 'committed', commit_sha: 'd'.repeat(40) },
      { id: 'agr_b', area_id: 'trips', text: 'Group trips later.', status: 'proposed', proposed_by: 'u-gone', proposed_by_name: 'Old member' },
    ],
    votes: [
      { agreement_id: 'agr_b', user_id: 'u-owner', vote: 'not_yet', comment: 'Needs pricing first.' },
      { agreement_id: 'agr_a', user_id: 'u2', vote: 'agree' },
    ],
    decisions: [
      { id: 'dec_1', pr_number: 57, head_sha: 'e'.repeat(40), type: 'accepted', state: 'done', actor_user_id: 'u-owner', note: 'Fine for now', edits: { summary: ['Add a rule'] }, created_at: '2026-11-20T00:00:00Z' },
      { id: 'dec_2', pr_number: 58, head_sha: 'f'.repeat(40), type: 'sent_back', state: 'dismissed', actor_user_id: 'u2', created_at: '2026-11-21T00:00:00Z' },
      { id: 'dec_3', pr_number: 59, head_sha: '3'.repeat(40), type: 'accepted', state: 'failed', actor_user_id: 'u2', created_at: '2026-11-19T00:00:00Z' },
      { id: 'dec_4', pr_number: 61, head_sha: '4'.repeat(40), type: 'accepted', state: 'working', actor_user_id: 'u2', created_at: '2026-11-18T00:00:00Z' },
    ],
    checks: [
      { pr_number: 57, head_sha: 'e'.repeat(40), status: 'done', verdict: 'drifts', result_json: { summary: 'Stores card numbers.', conflicts: [{ area: 'billing', rule_or_agreement: 'Never store card numbers.', explanation: 'Adds a card column.' }] }, updated_at: '2026-11-20T00:00:00Z' },
      { pr_number: 60, head_sha: '1'.repeat(40), status: 'done', verdict: 'matches', result_json: { summary: 'Fine.' }, updated_at: '2026-10-01T00:00:00Z' },
    ],
  };
  const { tools } = setup({ rows });
  const agr = (await tools.call('get_agreements', {})).result.agreements;
  assert.strictEqual(agr[0].proposed_by, 'Dev');
  assert.strictEqual(agr[0].in_the_plan, 'dddddddddddd');
  assert.deepStrictEqual(agr[0].agree, ['Dev']);
  assert.strictEqual(agr[1].proposed_by, 'Old member');
  assert.deepStrictEqual(agr[1].not_yet, [{ who: 'Samyak', comment: 'Needs pricing first.' }]);
  assert.deepStrictEqual((await tools.call('get_agreements', { status: 'proposed' })).result.sources, ['agr_b']);
  assert.strictEqual((await tools.call('get_agreements', { status: 'maybe' })).ok, false);

  const dec = (await tools.call('get_decisions', {})).result;
  assert.deepStrictEqual(dec.decisions.map((d) => d.source_id), ['dec_1', 'dec_3', 'dec_4'], 'dismissed decisions are left out');
  assert.strictEqual(dec.decisions[0].by, 'Samyak');
  assert.deepStrictEqual(dec.decisions.map((d) => [d.decision, d.finished]), [
    ['accepted the change', true],
    ['chose to accept the change, but it didn\'t go through', false],
    ['chose to accept the change; not finished yet', false],
  ]);
  assert.deepStrictEqual((await tools.call('get_decisions', { pr: '#58' })).result.decisions, []);

  const checks = (await tools.call('get_pr_checks', { verdict: 'drifts' })).result.checks;
  assert.strictEqual(checks[0].source_id, 'pr#57@eeeeeeeeeeee');
  assert.deepStrictEqual(checks[0].conflicts, [{ area: 'billing', rule: 'Never store card numbers.', why: 'Adds a card column.' }]);
  assert.strictEqual((await tools.call('get_pr_checks', { since: '2026-11-01' })).result.checks.length, 1);
  assert.match((await tools.call('get_pr_checks', { pr: 99 })).result.message, /hasn't checked PR #99/);
});

test('people: members by name, Creators who aren’t members only counted', async () => {
  const { tools } = setup();
  const r = (await tools.call('get_people', {})).result;
  assert.deepStrictEqual(r.members.map((m) => [m.name, m.owner]), [['Samyak', true], ['Dev', false]]);
  assert.ok(!JSON.stringify(r).includes('@example.com'), 'no emails');
  assert.deepStrictEqual(r.areas.find((a) => a.area === 'trips'), { area: 'trips', name: 'Trips', creators: [], creators_not_on_project: 1 });
  assert.deepStrictEqual(r.areas.find((a) => a.area === 'billing').creators, ['Samyak']);
  const noName = setup({ rows: {
    members: [
      { user_id: 'u-owner', email: 'samyak.private@example.com', labels: [] },
      { user_id: 'u2', display_name: 'dev.private@example.com', email: 'dev.private@example.com', labels: [] },
    ],
    agreements: [{ id: 'agr_e', text: 'X.', status: 'proposed', proposed_by: 'u-gone', proposed_by_name: 'gone.private@example.com' }],
  } });
  const m = (await noName.tools.call('get_people', {})).result.members;
  assert.deepStrictEqual(m.map((x) => x.name), ['A member', 'A member']);
  const ag = (await noName.tools.call('get_agreements', {})).result.agreements;
  assert.strictEqual(ag[0].proposed_by, 'Someone no longer on the project');
  assert.ok(!JSON.stringify([m, ag]).includes('.private'), 'no email, or part of one, stands in for a name');
});

test('capabilities and recent changes', async () => {
  const commits = [
    { sha: 'a'.repeat(40), title: 'Add annual plan (#57)', authorLogin: 'dev', date: '2026-11-26T00:00:00Z' },
    { sha: 'b'.repeat(40), title: 'Merge pull request #60 from acme/x', author: 'Dev', date: '2026-11-25T00:00:00Z' },
    { sha: '2'.repeat(40), title: 'Tidy', authorLogin: 'dev', date: '2026-11-24T00:00:00Z' },
  ];
  const rows = {
    statements: [{ id: 's1', text: 'Users can split a bill', feature_area: 'billing', satisfied: true }, { id: 's2', text: 'Export to PDF', satisfied: null }],
    checks: [{ pr_number: 57, head_sha: 'e'.repeat(40), status: 'done', verdict: 'drifts', result_json: {} }],
  };
  const gh = fakeGithub({ commits });
  const { tools } = setup({ rows, gh });
  const caps = (await tools.call('get_capabilities', { query: 'split' })).result.capabilities;
  assert.deepStrictEqual(caps, [{ source_id: 'intent:s1', text: 'Users can split a bill', area: 'billing', holds_in_code: 'yes', last_checked: null }]);
  const rc = (await tools.call('recent_changes', { since: '2020-01-01' })).result;
  assert.strictEqual(rc.since, '2026-08-29', 'at most 90 days back');
  assert.deepStrictEqual(rc.commits.map((c) => [c.pr, c.pr_check && c.pr_check.verdict]), [[57, 'drifts'], [60, null], [null, null]]);
  const opts = gh.calls.find((c) => Array.isArray(c) && c[0] === 'commits')[1];
  assert.strictEqual(opts.branch, 'main');
  assert.strictEqual(opts.perPage, 50);
  const off = setup({ gh: fakeGithub({ fail: true }) });
  assert.strictEqual((await off.tools.call('recent_changes', {})).result.available, false);
});

test('an unknown tool, bad input and a failing store come back as tool errors, not exceptions', async () => {
  const index = fakeIndex();
  index.search = async () => { throw new Error('connection reset by 10.0.0.5'); };
  const { tools } = setup({ index });
  assert.deepStrictEqual(await tools.call('delete_everything', {}), { ok: false, error: 'There is no tool called delete_everything.' });
  assert.strictEqual((await tools.call('search_code', {})).ok, false);
  const failed = await tools.call('search_code', { query: 'charge' });
  assert.strictEqual(failed.ok, false);
  assert.ok(!/10\.0\.0\.5/.test(failed.error), 'no internal detail');
});

test('no network and no model were used', () => {
  assert.deepStrictEqual(fetchCalls, []);
  assert.deepStrictEqual(Object.keys(require.cache).filter((k) => /anthropic/i.test(k)), []);
  global.fetch = realFetch;
});

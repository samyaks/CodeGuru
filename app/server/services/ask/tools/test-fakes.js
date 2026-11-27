'use strict';

// Fakes for Ask's tools and agent tests: a stored index built through the
// same filter the real one uses, a GitHub client, and the project stores.

const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createAskTools } = require('./index');
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


module.exports = { FIXTURES, YAML, AWS, RAW, storedFiles, fakeIndex, fakeGithub, project, setup };

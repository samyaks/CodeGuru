const test = require('node:test');
const assert = require('node:assert');

const dbPath = require.resolve('../../lib/db');

// Mutable fake DB state the mocked repos read/write.
const state = {
  projects: new Set(['p1']),
  confirmed: [],
  statementsById: new Map(),
  activeClaims: [],
  created: [],
  setSatisfaction: [],
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    deployments: {
      async findById(id) { return state.projects.has(id) ? { id } : null; },
    },
    intentStatements: {
      async findConfirmedByProjectId() { return state.confirmed; },
      async findById(id) { return state.statementsById.get(id) || null; },
      async setSatisfaction(id, projectId, fields) {
        state.setSatisfaction.push({ id, ...fields });
        return { id };
      },
    },
    claims: {
      async findActiveByStatement(projectId, statementId) {
        return state.activeClaims.find((c) => c.statement_id === statementId && c.status === 'active') || null;
      },
      async findActiveByArea(projectId, featureArea) {
        return state.activeClaims.find((c) => c.feature_area === featureArea && !c.statement_id && c.status === 'active') || null;
      },
      async findActiveByClaimant(projectId, claimantId) {
        return state.activeClaims.filter((c) => c.claimant_id === claimantId && c.status === 'active');
      },
      async create({ projectId, statementId = null, featureArea = null, claimantType, claimantId }) {
        const claim = {
          id: `c${state.created.length + 1}`, project_id: projectId, statement_id: statementId,
          feature_area: featureArea, claimant_type: claimantType, claimant_id: claimantId, status: 'active',
        };
        state.created.push(claim);
        state.activeClaims.push(claim);
        return claim;
      },
    },
    analysisFiles: {
      async getContentsMap() { return { 'a.js': 'code' }; },
    },
  },
};

const {
  McpToolError, getIntent, checkIntent, claimIntent, getMyGaps, resolveGap,
} = require('./mcp-tools');

function reset() {
  state.projects = new Set(['p1']);
  state.confirmed = [];
  state.statementsById = new Map();
  state.activeClaims = [];
  state.created = [];
  state.setSatisfaction = [];
}

const link = (file_path, symbol = 'x', link_status = 'healthy') => ({ file_path, symbol, link_status });

test('assertProject: unknown project throws not_found', async () => {
  reset();
  await assert.rejects(() => getIntent('nope'), (e) => e instanceof McpToolError && e.code === 'not_found');
});

test('get_intent returns confirmed statements, filterable by area', async () => {
  reset();
  state.confirmed = [
    { id: 's1', status: 'confirmed', kind: 'behavior', text: 'a', feature_area: 'auth', links: [link('a.js')] },
    { id: 's2', status: 'confirmed', kind: 'behavior', text: 'b', feature_area: 'billing', links: [link('b.js')] },
  ];
  const all = await getIntent('p1');
  assert.strictEqual(all.statements.length, 2);
  const auth = await getIntent('p1', 'auth');
  assert.strictEqual(auth.statements.length, 1);
  assert.strictEqual(auth.statements[0].id, 's1');
});

test('check_intent returns statements whose links touch the file', async () => {
  reset();
  state.confirmed = [
    { id: 's1', status: 'confirmed', kind: 'behavior', text: 'a', feature_area: 'auth', links: [link('a.js')] },
    { id: 's2', status: 'confirmed', kind: 'behavior', text: 'b', feature_area: 'x', links: [link('b.js')] },
  ];
  const res = await checkIntent('p1', 'a.js');
  assert.strictEqual(res.statements.length, 1);
  assert.strictEqual(res.statements[0].id, 's1');
  await assert.rejects(() => checkIntent('p1', ''), McpToolError);
});

test('claim_intent creates, is idempotent for owner, flags conflict for others', async () => {
  reset();
  state.statementsById.set('s1', { id: 's1', status: 'confirmed', links: [] });

  const first = await claimIntent('p1', { claimantType: 'agent', claimantId: 'agentA', statementId: 's1' });
  assert.strictEqual(first.conflict, false);
  assert.strictEqual(first.alreadyHeld, false);
  assert.strictEqual(state.created.length, 1);

  const again = await claimIntent('p1', { claimantType: 'agent', claimantId: 'agentA', statementId: 's1' });
  assert.strictEqual(again.alreadyHeld, true);
  assert.strictEqual(again.conflict, false);
  assert.strictEqual(state.created.length, 1, 'no duplicate claim for the same owner');

  const other = await claimIntent('p1', { claimantType: 'agent', claimantId: 'agentB', statementId: 's1' });
  assert.strictEqual(other.conflict, true);
  assert.strictEqual(other.claim.claimant_id, 'agentA', 'returns the incumbent claim');
});

test('claim_intent validates target/claimant', async () => {
  reset();
  await assert.rejects(() => claimIntent('p1', { claimantType: 'robot', claimantId: 'x', statementId: 's1' }), McpToolError);
  await assert.rejects(() => claimIntent('p1', { claimantType: 'agent', claimantId: '', statementId: 's1' }), McpToolError);
  await assert.rejects(() => claimIntent('p1', { claimantType: 'agent', claimantId: 'x' }), McpToolError);
  await assert.rejects(() => claimIntent('p1', { claimantType: 'agent', claimantId: 'x', statementId: 's1', featureArea: 'auth' }), McpToolError);
});

test('get_my_gaps returns only gaps under the claimant claims', async () => {
  reset();
  state.confirmed = [
    // unsatisfied -> gap, claimed directly by statement
    { id: 's1', status: 'confirmed', kind: 'behavior', text: 'a', feature_area: 'auth', satisfied: false, links: [link('a.js')] },
    // unsatisfied -> gap, under a claimed AREA (billing)
    { id: 's2', status: 'confirmed', kind: 'behavior', text: 'b', feature_area: 'billing', satisfied: false, links: [link('b.js')] },
    // unsatisfied -> gap but NOT claimed
    { id: 's3', status: 'confirmed', kind: 'behavior', text: 'c', feature_area: 'other', satisfied: false, links: [link('c.js')] },
  ];
  state.activeClaims = [
    { id: 'c1', statement_id: 's1', feature_area: null, claimant_id: 'me', status: 'active' },
    { id: 'c2', statement_id: null, feature_area: 'billing', claimant_id: 'me', status: 'active' },
  ];
  const res = await getMyGaps('p1', 'me');
  const ids = res.gaps.map((g) => g.statementId).sort();
  assert.deepStrictEqual(ids, ['s1', 's2']);
  assert.strictEqual(res.claims, 2);

  const none = await getMyGaps('p1', 'stranger');
  assert.deepStrictEqual(none.gaps, []);
});

test('resolve_gap re-checks one statement via injected llmCheck', async () => {
  reset();
  const stmt = { id: 's1', status: 'confirmed', kind: 'behavior', text: 'x', links: [link('a.js')], satisfied: true };
  state.statementsById.set('s1', stmt);

  const res = await resolveGap('p1', 's1', { contents: { 'a.js': 'changed' }, llmCheck: async () => ({ satisfied: false, reason: 'gone' }) });
  assert.strictEqual(res.satisfied, false);
  assert.strictEqual(res.reason, 'gone');
  assert.strictEqual(state.setSatisfaction.length, 1);
  assert.strictEqual(state.setSatisfaction[0].satisfied, false);
});

test('resolve_gap skips non-confirmed statements without an LLM call', async () => {
  reset();
  state.statementsById.set('s1', { id: 's1', status: 'candidate', links: [link('a.js')], satisfied: null });
  let called = false;
  const res = await resolveGap('p1', 's1', { contents: { 'a.js': 'x' }, llmCheck: async () => { called = true; return { satisfied: true }; } });
  assert.strictEqual(res.skipped, 'not_confirmed');
  assert.strictEqual(called, false);
  assert.strictEqual(state.setSatisfaction.length, 0);
});

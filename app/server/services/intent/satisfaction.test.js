const test = require('node:test');
const assert = require('node:assert');

// Mock the DB repo before requiring the module so no real connection is made.
// findConfirmedByProjectId returns our fixtures; setSatisfaction is captured.
const dbPath = require.resolve('../../lib/db');

let confirmedRows = [];
const captured = { setSatisfaction: [] };

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    intentStatements: {
      async findConfirmedByProjectId() {
        return confirmedRows;
      },
      async setSatisfaction(id, projectId, fields) {
        captured.setSatisfaction.push({ id, projectId, ...fields });
        return { id };
      },
    },
    analysisFiles: {
      async getContentsMap() {
        return {};
      },
    },
  },
};

const { hashLinkedFiles, runSatisfactionRecheck } = require('./satisfaction');

function reset() {
  confirmedRows = [];
  captured.setSatisfaction = [];
}

test('hashLinkedFiles is deterministic, order-independent, and null-safe', () => {
  const contents = { 'a.js': 'AAA', 'b.js': 'BBB' };
  const links1 = [{ file_path: 'a.js', symbol: 'x' }, { file_path: 'b.js', symbol: 'y' }];
  const links2 = [{ file_path: 'b.js', symbol: 'y' }, { file_path: 'a.js', symbol: 'x' }];
  const h1 = hashLinkedFiles(contents, links1);
  const h2 = hashLinkedFiles(contents, links2);
  assert.strictEqual(h1, h2, 'link order must not change the hash');
  assert.strictEqual(h1.length, 64);

  const changed = hashLinkedFiles({ 'a.js': 'AAA!', 'b.js': 'BBB' }, links1);
  assert.notStrictEqual(changed, h1, 'content change must change the hash');

  assert.strictEqual(hashLinkedFiles({}, links1), null, 'no captured content -> null');
  assert.strictEqual(hashLinkedFiles(contents, []), null, 'no links -> null');
});

test('tier 1: unchanged hash skips the LLM and preserves satisfied', async () => {
  reset();
  const contents = { 'a.js': 'function login(){}' };
  const links = [{ file_path: 'a.js', symbol: 'login', link_status: 'healthy' }];
  const baseline = hashLinkedFiles(contents, links);
  confirmedRows = [{ id: 's1', kind: 'behavior', text: 't', links, code_hash: baseline, satisfied: true }];

  let llmCalled = false;
  const stats = await runSatisfactionRecheck('p1', {
    contents,
    llmCheck: async () => { llmCalled = true; return { satisfied: false }; },
  });

  assert.strictEqual(llmCalled, false, 'unchanged code must not call the LLM');
  assert.strictEqual(stats.unchanged, 1);
  assert.strictEqual(stats.llmCalls, 0);
  assert.strictEqual(captured.setSatisfaction.length, 1);
  assert.strictEqual(captured.setSatisfaction[0].satisfied, true);
  assert.strictEqual(captured.setSatisfaction[0].codeHash, baseline);
});

test('tier 2: changed code, still satisfied -> new baseline, satisfied true', async () => {
  reset();
  const contents = { 'a.js': 'function login(){ return newImpl(); }' };
  const links = [{ file_path: 'a.js', symbol: 'login', link_status: 'healthy' }];
  confirmedRows = [{ id: 's1', kind: 'behavior', text: 't', links, code_hash: 'STALE', satisfied: true }];

  const stats = await runSatisfactionRecheck('p1', {
    contents,
    llmCheck: async () => ({ satisfied: true, reason: 'still holds' }),
  });

  assert.strictEqual(stats.rechecked, 1);
  assert.strictEqual(stats.drifted, 0);
  assert.strictEqual(stats.llmCalls, 1);
  const set = captured.setSatisfaction[0];
  assert.strictEqual(set.satisfied, true);
  assert.strictEqual(set.codeHash, hashLinkedFiles(contents, links), 'baseline advances to the new hash');
});

test('tier 2: changed code, no longer satisfied -> drift recorded', async () => {
  reset();
  const contents = { 'a.js': 'function login(){ /* removed */ }' };
  const links = [{ file_path: 'a.js', symbol: 'login', link_status: 'healthy' }];
  confirmedRows = [{ id: 's1', kind: 'behavior', text: 't', links, code_hash: 'STALE', satisfied: true }];

  const stats = await runSatisfactionRecheck('p1', {
    contents,
    llmCheck: async () => ({ satisfied: false, reason: 'behavior gone' }),
  });

  assert.strictEqual(stats.drifted, 1);
  assert.strictEqual(captured.setSatisfaction[0].satisfied, false);
});

test('LLM failure leaves the prior verdict untouched (no write)', async () => {
  reset();
  const contents = { 'a.js': 'changed' };
  const links = [{ file_path: 'a.js', symbol: 'login', link_status: 'healthy' }];
  confirmedRows = [{ id: 's1', kind: 'behavior', text: 't', links, code_hash: 'STALE', satisfied: true }];

  const stats = await runSatisfactionRecheck('p1', {
    contents,
    llmCheck: async () => { throw new Error('api down'); },
  });

  assert.strictEqual(stats.rechecked, 0);
  assert.strictEqual(stats.drifted, 0);
  assert.strictEqual(captured.setSatisfaction.length, 0, 'transient failure must not flip the verdict');
});

test('no confirmed statements -> no work, no LLM', async () => {
  reset();
  confirmedRows = [];
  const stats = await runSatisfactionRecheck('p1', { contents: {}, llmCheck: async () => ({ satisfied: false }) });
  assert.deepStrictEqual(stats, { confirmed: 0, unchanged: 0, rechecked: 0, drifted: 0, llmCalls: 0 });
});

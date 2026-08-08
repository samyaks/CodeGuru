const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

// --- Stub everything run-read touches BEFORE requiring it ----------------
// db, synthesize-read and next-thing are stubbed via require.cache (same
// pattern as synthesize-read.test.js) so nothing hits Postgres or Claude.
//
// code-slice.js and pick-core-job.js are being written in a PARALLEL
// workstream and may not exist on disk yet. If a module file is absent,
// Node's resolver throws before ever consulting require.cache — which is
// exactly the failure run-read's lazy-require-in-try pattern must absorb.
// So: stub them when present (and assert the stub value flows through),
// assert graceful null-degradation when absent. Both paths are real.

function stubModule(absPath, exports) {
  require.cache[absPath] = { id: absPath, filename: absPath, loaded: true, exports };
}

const state = {
  synthCalls: [],
  synthError: null,
  deriveCalls: [],
  claimUpserts: [],
  readUpserts: [],
  nextUpdates: [],
  codeSliceCalls: [],
  pickCalls: [],
};

function reset() {
  state.synthCalls = [];
  state.synthError = null;
  state.deriveCalls = [];
  state.claimUpserts = [];
  state.readUpserts = [];
  state.nextUpdates = [];
  state.codeSliceCalls = [];
  state.pickCalls = [];
}

const MAP = { domain: 'Habits', personas: [{ id: 'p0', name: 'Solo improver' }], jobs: [], entities: [] };
const INVARIANT_ROWS = [
  { id: 'i1', scope: 'job', text: 'check-in under ten seconds', confidence: 0.9, links: [] },
  { id: 'i2', scope: 'system', text: 'system-scoped, filtered out', confidence: 0.95, links: [] },
];
const CLAIM_ROWS = [
  { id: 'c1', slot: 'objective', text: 'human-corrected objective', status: 'settled', source: 'human' },
  { id: 'c2', slot: 'audience', text: 'drafted audience', status: 'drafted', source: 'inferred' },
  { id: 'c3', slot: 'core_job', text: 'drafted core job', status: 'drafted', source: 'inferred' },
];
const SLICE = { files: [], knownPaths: ['src/a.js'], truncated: false, source: 'db' };
const CANDIDATE = { invariant: INVARIANT_ROWS[0], job: null, personaName: null, reason: 'top confidence' };

stubModule(require.resolve('../../lib/db'), {
  deployments: {
    async findById(id) {
      return {
        id,
        analysis_data: { fileTree: ['a.js', 'b.js'], gaps: [] },
        features_summary: 'features',
        description: 'desc',
        stack_info: { framework: 'Express' },
        readiness_score: 40,
        readiness_categories: {},
      };
    },
  },
  productMap: { async getMapByProject() { return MAP; } },
  intentStatements: { async findByProjectId() { return INVARIANT_ROWS; } },
  suggestions: { async findV2SecurityGapsByProjectId() { return []; } },
  projectReads: {
    async upsertForProject(projectId, patch) { state.readUpserts.push({ projectId, patch }); return patch; },
    async findByProjectId() { return null; },
    async updateNext(projectId, patch) { state.nextUpdates.push({ projectId, patch }); return patch; },
  },
  readClaims: {
    async findByProjectId() { return CLAIM_ROWS; },
    async upsertDraft(projectId, claim) {
      state.claimUpserts.push({ projectId, claim });
      // Settled slot: the real upsert's WHERE clause makes it a no-op.
      return claim.slot === 'objective' ? null : { ...claim };
    },
  },
});

stubModule(require.resolve('./synthesize-read'), {
  async synthesizeRead(inputs) {
    state.synthCalls.push(inputs);
    if (state.synthError) throw state.synthError;
    return {
      claims: [
        { slot: 'objective', text: 'o', confidence: 0.7, evidence: [], alternative: null },
        { slot: 'audience', text: 'a', confidence: 0.4, evidence: [], alternative: null },
        { slot: 'core_job', text: 'c', confidence: 0.9, evidence: [], alternative: null },
      ],
    };
  },
});

stubModule(require.resolve('./next-thing'), {
  async deriveNextThing(inputs, settledClaims) {
    state.deriveCalls.push({ inputs, settledClaims });
    return { title: 'T', why: 'W', prompt: 'P', category: 'auth' };
  },
});

const codeSlicePath = path.join(__dirname, 'code-slice.js');
const hasCodeSlice = fs.existsSync(codeSlicePath);
if (hasCodeSlice) {
  stubModule(codeSlicePath, {
    async buildCodeSlice(projectId, opts) {
      state.codeSliceCalls.push({ projectId, opts });
      return SLICE;
    },
  });
}

const pickCoreJobPath = path.join(__dirname, 'pick-core-job.js');
const hasPickCoreJob = fs.existsSync(pickCoreJobPath);
if (hasPickCoreJob) {
  stubModule(pickCoreJobPath, {
    pickCoreJob({ map, invariants }) {
      state.pickCalls.push({ map, invariants });
      return CANDIDATE;
    },
  });
}

const { runRead, rederiveNext } = require('./run-read');

test('runRead wires code slice, settled claims and core-job candidate into synthesis inputs', async () => {
  reset();
  const codebaseModel = { marker: 'in-memory-model' };

  const result = await runRead('proj-1', codebaseModel);

  assert.deepStrictEqual(result, { ran: true, claimsPersisted: 2, hasNext: true });

  assert.strictEqual(state.synthCalls.length, 1);
  const inputs = state.synthCalls[0];

  // Every pre-existing input survives.
  assert.strictEqual(inputs.projectId, 'proj-1');
  assert.strictEqual(inputs.map, MAP);
  assert.deepStrictEqual(inputs.invariants.map((i) => i.id), ['i1']); // job-scoped only
  assert.strictEqual(inputs.featuresSummary, 'features');
  assert.strictEqual(inputs.fileCount, 2);

  // New inputs.
  assert.deepStrictEqual(inputs.settledClaims, [{ slot: 'objective', text: 'human-corrected objective' }]);
  if (hasCodeSlice) {
    assert.strictEqual(inputs.codeSlice, SLICE);
    assert.strictEqual(state.codeSliceCalls.length, 1);
    assert.strictEqual(state.codeSliceCalls[0].projectId, 'proj-1');
    assert.strictEqual(state.codeSliceCalls[0].opts.codebaseModel, codebaseModel);
  } else {
    assert.strictEqual(inputs.codeSlice, null, 'code slice degrades to null when the module is absent');
  }
  if (hasPickCoreJob) {
    assert.strictEqual(inputs.coreJobCandidate, CANDIDATE);
    assert.strictEqual(state.pickCalls[0].map, MAP);
  } else {
    assert.strictEqual(inputs.coreJobCandidate, null, 'core-job pick degrades to null when the module is absent');
  }

  // All three claims went through the upsert; the settled one returned null.
  assert.deepStrictEqual(state.claimUpserts.map((u) => u.claim.slot), ['objective', 'audience', 'core_job']);

  // Next-thing derived from ALL current claim rows and persisted.
  assert.strictEqual(state.deriveCalls.length, 1);
  assert.deepStrictEqual(
    state.deriveCalls[0].settledClaims.map((c) => c.slot),
    ['objective', 'audience', 'core_job']
  );
  assert.strictEqual(state.readUpserts.length, 1);
  assert.strictEqual(state.readUpserts[0].patch.nextTitle, 'T');
});

test('claim synthesis failure is non-fatal: next-thing still derived and persisted', async () => {
  reset();
  state.synthError = new Error('claude fell over');

  const result = await runRead('proj-1', null);

  assert.deepStrictEqual(result, { ran: true, claimsPersisted: 0, hasNext: true });
  assert.strictEqual(state.claimUpserts.length, 0);
  assert.strictEqual(state.readUpserts.length, 1);
});

test('rederiveNext skips the code slice load and updates only next_*', async () => {
  reset();

  const next = await rederiveNext('proj-1');

  assert.deepStrictEqual(next, { title: 'T', why: 'W', prompt: 'P', category: 'auth' });
  assert.strictEqual(state.codeSliceCalls.length, 0, 'code slice is not loaded for rederive');
  assert.strictEqual(state.synthCalls.length, 0, 'no re-synthesis on rederive');
  assert.strictEqual(state.nextUpdates.length, 1);
  assert.strictEqual(state.nextUpdates[0].patch.nextTitle, 'T');
  // Inputs still carry settled claims (harmless for next-thing).
  assert.deepStrictEqual(state.deriveCalls[0].inputs.settledClaims, [
    { slot: 'objective', text: 'human-corrected objective' },
  ]);
  assert.strictEqual(state.deriveCalls[0].inputs.codeSlice, null);
});

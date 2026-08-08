const { test } = require('node:test');
const assert = require('node:assert');

// Mock the db repos BEFORE requiring the module under test (same
// require.cache approach as read-flow.test.js). generate-invariants is
// lazily required inside ensureInvariants, so it gets a cache entry too —
// the no-op gate tests never reach it, the success test asserts on it.

const state = {
  statements: [],
  map: null,
  contents: {},
  contentsOpts: null,
  genArgs: null,
  genResult: { generated: true, jobs: 2, persisted: 3 },
  throwOn: null,
};

const dbPath = require.resolve('../../lib/db');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    intentStatements: {
      async findByProjectId(projectId, opts) {
        if (state.throwOn === 'statements') throw new Error('db exploded');
        assert.deepStrictEqual(opts, { archived: false });
        return state.statements;
      },
    },
    productMap: {
      async getMapByProject() {
        return state.map;
      },
    },
    analysisFiles: {
      async getContentsMap(projectId, opts) {
        state.contentsOpts = opts;
        return state.contents;
      },
    },
  },
};

const genPath = require.resolve('../intent/generate-invariants');
require.cache[genPath] = {
  id: genPath,
  filename: genPath,
  loaded: true,
  exports: {
    async runJobInvariantGeneration(projectId, codebaseModel, opts) {
      state.genArgs = { projectId, codebaseModel, opts };
      return state.genResult;
    },
  },
};

const { ensureInvariants } = require('./ensure-invariants');

function reset() {
  state.statements = [];
  state.map = null;
  state.contents = {};
  state.contentsOpts = null;
  state.genArgs = null;
  state.genResult = { generated: true, jobs: 2, persisted: 3 };
  state.throwOn = null;
}

const MAP_WITH_JOBS = {
  map: { id: 'map-1' },
  personas: [{ id: 'persona:0', name: 'Habit builder' }],
  jobs: [{ id: 'job:0', persona_id: 'persona:0', title: 'Log a habit fast', priority: 'high' }],
  entities: [],
  edges: [],
};

// ── no-op gates ─────────────────────────────────────────────────────

test('existing invariants (any scope) -> generated:false, no generation call', async () => {
  reset();
  state.statements = [{ id: 'stmt-1', scope: 'global' }];
  const out = await ensureInvariants('proj-1');
  assert.strictEqual(out.generated, false);
  assert.strictEqual(out.count, 0);
  assert.match(out.reason, /already exist/);
  assert.strictEqual(state.genArgs, null);
});

test('no product map -> generated:false', async () => {
  reset();
  state.map = null;
  const out = await ensureInvariants('proj-1');
  assert.strictEqual(out.generated, false);
  assert.match(out.reason, /no product map/);
  assert.strictEqual(state.genArgs, null);
});

test('map without jobs -> generated:false', async () => {
  reset();
  state.map = { ...MAP_WITH_JOBS, jobs: [] };
  const out = await ensureInvariants('proj-1');
  assert.strictEqual(out.generated, false);
  assert.match(out.reason, /no product map/);
});

test('no stored file contents -> generated:false', async () => {
  reset();
  state.map = MAP_WITH_JOBS;
  state.contents = {};
  const out = await ensureInvariants('proj-1');
  assert.strictEqual(out.generated, false);
  assert.match(out.reason, /file contents/);
  // Full-tier only: skeletons must be excluded from the rehydrated model.
  assert.deepStrictEqual(state.contentsOpts, { includeSkeletons: false });
  assert.strictEqual(state.genArgs, null);
});

// ── generation path ──────────────────────────────────────────────────

test('generates: rehydrates model and returns counts + model', async () => {
  reset();
  state.map = MAP_WITH_JOBS;
  state.contents = {
    'src/habit.js': 'function logCheckin() { return true; }\nmodule.exports = { logCheckin };',
  };
  const out = await ensureInvariants('proj-1');

  assert.strictEqual(out.generated, true);
  assert.strictEqual(out.count, 3);
  assert.match(out.reason, /generated 3 invariants across 2 jobs/);

  // The generator got the rehydrated model, and the same model is returned
  // so the route can thread it into runRead.
  assert.strictEqual(state.genArgs.projectId, 'proj-1');
  assert.deepStrictEqual(state.genArgs.opts, {});
  const model = state.genArgs.codebaseModel;
  assert.strictEqual(out.model, model);
  assert.deepStrictEqual(model.fileContents, state.contents);
  assert.deepStrictEqual(model.fileTree, ['src/habit.js']);
  assert.ok(Array.isArray(model.structureAnchors));
});

test('generator reports nothing generated -> generated:false with its reason', async () => {
  reset();
  state.map = MAP_WITH_JOBS;
  state.contents = { 'src/a.js': 'const x = 1;' };
  state.genResult = { generated: false, reason: 'no_map', jobs: 0 };
  const out = await ensureInvariants('proj-1');
  assert.strictEqual(out.generated, false);
  assert.strictEqual(out.count, 0);
  assert.strictEqual(out.reason, 'no_map');
});

// ── never throws ─────────────────────────────────────────────────────

test('db failure -> resolves generated:false with the error message', async () => {
  reset();
  state.throwOn = 'statements';
  const out = await ensureInvariants('proj-1');
  assert.deepStrictEqual(out, { generated: false, count: 0, reason: 'db exploded' });
});

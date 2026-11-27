const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Stand-ins for the db, verifier and re-analyze scheduler, installed before
// shipped-runner loads them.
const recorded = [];
let failOn = null;
function stub(rel, exports) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
}
stub('../../lib/db', {
  shippedItems: {
    findByCommit: async (projectId, sha) => recorded.find((r) => r.commit_sha === sha) || null,
    create: async (row) => {
      if (row.commit_sha === failOn) throw new Error('db down');
      recorded.push(row);
    },
  },
  suggestions: {
    findV2GapsByProjectId: async () => [{ id: 'g1', v2_status: 'untriaged', title: 'Add billing page', category: 'feature' }],
    setV2Status: async () => {},
  },
});
stub('./gap-verifier', { verifyGap: async () => ({ verification: 'verified', detail: 'ok' }) });
stub('./reanalyze-scheduler', { scheduleReanalyze: () => {} });
stub('./gap-matcher', {
  MIN_CONFIDENCE: 0.5,
  matchCommitToGap: () => ({ gapId: 'g1', confidence: 0.9, strategy: 'test' }),
});
stub('./gap-mapper', { toGap: (r) => ({ id: r.id }) });

const { processPush, processCommit } = require('./shipped-runner');

const project = { id: 'p1', branch: 'main' };

test('processCommit reports a failure instead of throwing', async () => {
  failOn = 'bad1';
  assert.deepStrictEqual((await processCommit({ project, commit: { id: 'ok1', message: 'x' }, branch: 'main' })).ok, true);
  const res = await processCommit({ project, commit: { id: 'bad1', message: 'x' }, branch: 'main' });
  assert.strictEqual(res.ok, false);
});

test('processPush rejects when a commit failed, so the push can be retried', async () => {
  failOn = 'bad2';
  const payload = { ref: 'refs/heads/main', commits: [{ id: 'ok2' }, { id: 'bad2' }] };
  await assert.rejects(() => processPush({ project, payload }), /1 of 2 commits failed: bad2/);
  failOn = null;
  await processPush({ project, payload });
  assert.ok(recorded.some((r) => r.commit_sha === 'bad2'), 'the retry records the commit that failed');
});

test('with Ask on, a default-branch push also updates the code index, without changing retries', async () => {
  const pushes = [];
  let reject = false;
  stub('../code-index', {
    getCodeIndex: () => ({
      onPush: async (p, payload) => { pushes.push([p.id, payload.after]); if (reject) throw new Error('index down'); },
    }),
  });
  const before = process.env.TAKEOFF_ASK_ENABLED;
  try {
    delete process.env.TAKEOFF_ASK_ENABLED;
    await processPush({ project, payload: { ref: 'refs/heads/main', after: 'a0', commits: [] } });
    assert.deepStrictEqual(pushes, [], 'nothing while Ask is off');

    process.env.TAKEOFF_ASK_ENABLED = '1';
    await processPush({ project, payload: { ref: 'refs/heads/main', after: 'a1', commits: [] } });
    await processPush({ project, payload: { ref: 'refs/heads/feature', after: 'a2', commits: [] } });
    reject = true;
    await processPush({ project, payload: { ref: 'refs/heads/main', after: 'a3', commits: [{ id: 'ok3' }] } });
    await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(pushes, [['p1', 'a1'], ['p1', 'a3']]);
  } finally {
    if (before === undefined) delete process.env.TAKEOFF_ASK_ENABLED; else process.env.TAKEOFF_ASK_ENABLED = before;
  }
});

const { test } = require('node:test');
const assert = require('node:assert');

const { autoConnectWebhook } = require('./github-webhook-manager');

function makeDeps({ installation = null, lookupError = null, connectResult = { ok: true, hookId: 1 } } = {}) {
  const calls = { lookups: [], connects: [] };
  return {
    calls,
    deps: {
      appInstallationForRepo: async (args) => {
        calls.lookups.push(args);
        if (lookupError) throw lookupError;
        return installation;
      },
      connectWebhook: async (args) => {
        calls.connects.push(args);
        return connectResult;
      },
    },
  };
}

const SCAN = { projectId: 'p1', owner: 'acme', repo: 'web', userToken: 'gho_x' };

test('auto-connect is skipped for a repo the scan read through the GitHub App', async () => {
  const { deps, calls } = makeDeps({ installation: 42 });
  const result = await autoConnectWebhook({ ...SCAN, installationId: 42 }, deps);
  assert.deepStrictEqual(result, { ok: true, skipped: 'github_app_installed', installationId: 42 });
  assert.deepStrictEqual(calls.lookups, [{ owner: 'acme', repo: 'web', knownInstallationId: 42 }]);
  assert.deepStrictEqual(calls.connects, []);
});

test('auto-connect is skipped when the App is installed on the repo without this user’s grant', async () => {
  const { deps, calls } = makeDeps({ installation: 77 });
  const result = await autoConnectWebhook(SCAN, deps);
  assert.strictEqual(result.skipped, 'github_app_installed');
  assert.deepStrictEqual(calls.lookups, [{ owner: 'acme', repo: 'web', knownInstallationId: null }]);
  assert.deepStrictEqual(calls.connects, []);
});

test('repos the App doesn’t cover still get a per-repo hook', async () => {
  const { deps, calls } = makeDeps({ installation: null });
  const result = await autoConnectWebhook(SCAN, deps);
  assert.deepStrictEqual(result, { ok: true, hookId: 1 });
  assert.deepStrictEqual(calls.connects, [{ projectId: 'p1', owner: 'acme', repo: 'web', userToken: 'gho_x' }]);
});

test('a failed installation lookup falls back to a per-repo hook', async () => {
  const { deps, calls } = makeDeps({ lookupError: Object.assign(new Error('GitHub API 500'), { status: 500 }) });
  await autoConnectWebhook(SCAN, deps);
  assert.strictEqual(calls.connects.length, 1);
});

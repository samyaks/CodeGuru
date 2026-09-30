const { test } = require('node:test');
const assert = require('node:assert');

const { resolveRepoAccess, clientForProject } = require('./github-access');

function makeDeps({ configured = true, grant = null, meta = null, metaError = null } = {}) {
  const calls = { findForUserRepo: 0, clientForInstallation: [] };
  const publicClient = {
    name: 'public',
    async fetchRepoMeta() {
      if (metaError) throw metaError;
      return meta;
    },
  };
  return {
    calls,
    publicClient,
    deps: {
      accessStore: {
        async findForUserRepo() {
          calls.findForUserRepo += 1;
          return grant;
        },
      },
      app: {
        isConfigured: () => configured,
        clientForInstallation: (id) => {
          calls.clientForInstallation.push(id);
          return { name: `installation-${id}` };
        },
      },
      publicClient,
    },
  };
}

const notFound = Object.assign(new Error('GitHub API 404'), { status: 404 });

test('a granted repo reads through its installation', async () => {
  const { deps } = makeDeps({ grant: { installation_id: '42' } });
  const access = await resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'secret' }, deps);
  assert.strictEqual(access.client.name, 'installation-42');
  assert.strictEqual(access.installationId, 42);
});

test('an ungranted public repo reads with the server token', async () => {
  const { deps, publicClient } = makeDeps({ meta: { private: false } });
  const access = await resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'oss' }, deps);
  assert.strictEqual(access.client, publicClient);
  assert.strictEqual(access.installationId, null);
});

test('the server token never stands in for a private repo', async () => {
  const { deps } = makeDeps({ meta: { private: true } });
  await assert.rejects(
    () => resolveRepoAccess({ userId: 'u1', owner: 'samyaks', repo: 'private-thing' }, deps),
    (err) => err.statusCode === 403 && err.code === 'GITHUB_APP_REQUIRED',
  );
});

test('signed-out users are asked to sign in for private or missing repos', async () => {
  const { deps, calls } = makeDeps({ metaError: notFound });
  await assert.rejects(
    () => resolveRepoAccess({ userId: null, owner: 'acme', repo: 'secret' }, deps),
    (err) => err.statusCode === 401 && err.code === 'GITHUB_SIGNIN_REQUIRED',
  );
  assert.strictEqual(calls.findForUserRepo, 0);
});

test('without the app configured, private repos are refused outright', async () => {
  const { deps, calls } = makeDeps({ configured: false, meta: { private: true } });
  await assert.rejects(
    () => resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'secret' }, deps),
    (err) => err.statusCode === 403 && err.code === 'FORBIDDEN',
  );
  assert.strictEqual(calls.findForUserRepo, 0);
});

test('non-404 GitHub errors (e.g. rate limits) propagate unchanged', async () => {
  const rateLimited = Object.assign(new Error('GitHub API rate limit exceeded'), { status: 403 });
  const { deps } = makeDeps({ metaError: rateLimited });
  await assert.rejects(
    () => resolveRepoAccess({ userId: 'u1', owner: 'acme', repo: 'oss' }, deps),
    (err) => err === rateLimited,
  );
});

test('clientForProject uses the stored installation, else the server token', () => {
  const { deps, publicClient } = makeDeps();
  assert.strictEqual(clientForProject({ github_installation_id: 7 }, deps).name, 'installation-7');
  assert.strictEqual(clientForProject({ github_installation_id: null }, deps), publicClient);
  assert.strictEqual(clientForProject(null, deps), publicClient);
});

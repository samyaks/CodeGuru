const { test, afterEach } = require('node:test');
const assert = require('node:assert');

const github = require('@codeguru/github');

const realFetch = global.fetch;
const realToken = process.env.GITHUB_TOKEN;

function captureFetch() {
  const seen = [];
  global.fetch = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ default_branch: 'main', private: false }),
      text: async () => '',
    };
  };
  return seen;
}

afterEach(() => {
  global.fetch = realFetch;
  if (realToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = realToken;
});

test('the default client reads with the server GITHUB_TOKEN', async () => {
  process.env.GITHUB_TOKEN = 'server-token';
  const seen = captureFetch();
  await github.fetchRepoMeta('acme', 'oss');
  assert.strictEqual(seen[0].headers.Authorization, 'Bearer server-token');
});

test('createClient({ token }) reads as that token, resolving getters per request', async () => {
  process.env.GITHUB_TOKEN = 'server-token';
  const seen = captureFetch();
  let n = 0;
  const client = github.createClient({ token: async () => `install-${++n}` });
  await client.fetchRepoMeta('acme', 'secret');
  await client.fetchRepoMeta('acme', 'secret');
  assert.deepStrictEqual(seen.map((s) => s.headers.Authorization), ['Bearer install-1', 'Bearer install-2']);
});

test('per-call headers merge with auth instead of replacing it', async () => {
  process.env.GITHUB_TOKEN = 'server-token';
  const seen = captureFetch();
  await github.fetchPRDiff('acme', 'oss', 1);
  assert.strictEqual(seen[0].headers.Accept, 'application/vnd.github.v3.diff');
  assert.strictEqual(seen[0].headers.Authorization, 'Bearer server-token');
});

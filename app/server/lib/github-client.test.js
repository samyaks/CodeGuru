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

test('a sha or branch that walks out of the repo is refused before any request', async () => {
  const seen = captureFetch();
  await assert.rejects(() => github.fetchCommitDetail('acme', 'a', '../../b/commits/main'), (err) => err.status === 400);
  await assert.rejects(() => github.fetchRepoTree('acme', 'a', '..%2F..%2Fb'), (err) => err.status === 400);
  await assert.rejects(() => github.fetchFileContent('acme', 'a', 'src/../../../b/contents/x'), (err) => err.status === 400);
  assert.strictEqual(seen.length, 0);
  await github.fetchRepoTree('acme', 'a', 'feature/x');
  assert.strictEqual(seen.length, 1);
  assert.match(seen[0].url, /\/repos\/acme\/a\/git\/trees\/feature\/x\?recursive=1$/);
});

test('query values are encoded, so a branch can’t add parameters', async () => {
  const seen = captureFetch();
  global.fetch = (orig => async (url, opts) => { const r = await orig(url, opts); r.json = async () => []; return r; })(global.fetch);
  await github.fetchCommits('acme', 'a', { branch: 'main&per_page=1' });
  assert.match(seen[0].url, /sha=main%26per_page%3D1&per_page=50$/);
});

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { createAppJwt, createGithubApp, readConfigFromEnv } = require('./github-app');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const CONFIG = {
  appId: '12345',
  slug: 'takeoff-test',
  clientId: 'Iv1.abc',
  clientSecret: 'shh',
  privateKey,
};

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('createAppJwt signs a verifiable RS256 JWT with a ≤10 minute window', () => {
  const now = Date.UTC(2026, 8, 30, 12, 0, 0);
  const jwt = createAppJwt({ appId: 12345, privateKey, now });
  const [h, p, sig] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.deepStrictEqual(header, { alg: 'RS256', typ: 'JWT' });
  assert.strictEqual(payload.iss, '12345');
  assert.strictEqual(payload.iat, now / 1000 - 60);
  assert.ok(payload.exp - payload.iat <= 600);
  const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, sig, 'base64url');
  assert.ok(ok, 'signature should verify with the public key');
});

test('readConfigFromEnv unescapes literal \\n in the private key', () => {
  const cfg = readConfigFromEnv({ GITHUB_APP_PRIVATE_KEY: 'line1\\nline2' });
  assert.strictEqual(cfg.privateKey, 'line1\nline2');
});

test('getInstallationToken caches until near expiry and shares concurrent mints', async () => {
  let clock = Date.UTC(2026, 8, 30, 12, 0, 0);
  let mints = 0;
  const fetchImpl = async (url, opts) => {
    assert.match(url, /\/app\/installations\/77\/access_tokens$/);
    assert.strictEqual(opts.method, 'POST');
    assert.match(opts.headers.Authorization, /^Bearer ey/);
    mints += 1;
    return jsonResponse({ token: `tok-${mints}`, expires_at: new Date(clock + 60 * 60 * 1000).toISOString() });
  };
  const app = createGithubApp(CONFIG, { fetchImpl, now: () => clock });

  const [a, b] = await Promise.all([app.getInstallationToken(77), app.getInstallationToken(77)]);
  assert.strictEqual(a, 'tok-1');
  assert.strictEqual(b, 'tok-1');
  assert.strictEqual(mints, 1);

  clock += 40 * 60 * 1000; // 20 min left → still cached
  assert.strictEqual(await app.getInstallationToken(77), 'tok-1');

  clock += 10 * 60 * 1000; // 10 min left → inside the refresh margin
  assert.strictEqual(await app.getInstallationToken(77), 'tok-2');
  assert.strictEqual(mints, 2);
});

test('findRepoInstallation asks GitHub as the app and treats 404 as not installed', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push(url);
    assert.match(opts.headers.Authorization, /^Bearer ey/);
    return url.endsWith('/repos/acme/web/installation')
      ? jsonResponse({ id: 314, account: { login: 'acme' } })
      : jsonResponse({ message: 'Not Found' }, 404);
  };
  const app = createGithubApp(CONFIG, { fetchImpl });
  assert.strictEqual(await app.findRepoInstallation('acme', 'web'), 314);
  assert.strictEqual(await app.findRepoInstallation('acme', 'other'), null);
  assert.deepStrictEqual(seen, [
    'https://api.github.com/repos/acme/web/installation',
    'https://api.github.com/repos/acme/other/installation',
  ]);
});

test('exchangeUserCode treats a 200 + { error } body as failure', async () => {
  const app = createGithubApp(CONFIG, {
    fetchImpl: async () => jsonResponse({ error: 'bad_verification_code', error_description: 'The code is incorrect or expired.' }),
  });
  await assert.rejects(() => app.exchangeUserCode('nope'), /code is incorrect or expired/);
});

test('listUserGrants paginates installations and their repositories', async () => {
  const calls = [];
  const repos = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, full_name: `acme/r${i + 1}`, private: i % 2 === 0 }));
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.strictEqual(opts.headers.Authorization, 'Bearer user-token');
    const u = new URL(url);
    const page = Number(u.searchParams.get('page'));
    if (u.pathname === '/user') return jsonResponse({ id: 555, login: 'octo' });
    if (u.pathname === '/user/installations') {
      return jsonResponse({ total_count: 1, installations: [{ id: 9, account: { login: 'acme' } }] });
    }
    if (u.pathname === '/user/installations/9/repositories') {
      return jsonResponse({ total_count: 130, repositories: repos.slice((page - 1) * 100, page * 100) });
    }
    throw new Error(`unexpected ${url}`);
  };
  const app = createGithubApp(CONFIG, { fetchImpl });
  const grants = await app.listUserGrants('user-token');
  assert.strictEqual(grants.length, 130);
  assert.deepStrictEqual(grants[0], {
    installationId: 9, accountLogin: 'acme', repoId: 1, repoFullName: 'acme/r1', private: true, githubUserId: 555,
  });
  assert.strictEqual(calls.filter((c) => c.includes('/repositories')).length, 2);
});

test('an unconfigured app reports so and refuses to build install URLs', () => {
  const app = createGithubApp({ ...CONFIG, privateKey: null });
  assert.strictEqual(app.isConfigured(), false);
  assert.throws(() => app.installUrl('s'), (err) => err.statusCode === 503);
});

test('installUrl and authorizeUrl carry the state', () => {
  const app = createGithubApp(CONFIG);
  assert.strictEqual(app.installUrl('abc'), 'https://github.com/apps/takeoff-test/installations/new?state=abc');
  const auth = new URL(app.authorizeUrl('abc'));
  assert.strictEqual(auth.searchParams.get('client_id'), 'Iv1.abc');
  assert.strictEqual(auth.searchParams.get('state'), 'abc');
});

test('a 404 or 403 minting an installation token marks the installation as gone', async () => {
  for (const status of [404, 403]) {
    const app = createGithubApp(CONFIG, { fetchImpl: async () => jsonResponse({ message: 'nope' }, status) });
    await assert.rejects(
      () => app.getInstallationToken(77),
      (err) => err.installationGone === true && err.status === status,
    );
  }
  const flaky = createGithubApp(CONFIG, { fetchImpl: async () => jsonResponse({ message: 'boom' }, 500) });
  await assert.rejects(() => flaky.getInstallationToken(77), (err) => !err.installationGone);
});

test('installation tokens are scoped to one repo, read-only, and cached per scope', async () => {
  const bodies = [];
  const fetchImpl = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return jsonResponse({ token: `tok-${bodies.length}`, expires_at: new Date(Date.now() + 3600e3).toISOString() });
  };
  const app = createGithubApp(CONFIG, { fetchImpl });
  assert.strictEqual(await app.getInstallationToken(77, { repo: 'web' }), 'tok-1');
  assert.strictEqual(await app.getInstallationToken(77, { repo: 'web' }), 'tok-1');
  assert.strictEqual(await app.getInstallationToken(77, { repo: 'api' }), 'tok-2');
  assert.deepStrictEqual(bodies[0], { repositories: ['web'], permissions: { contents: 'read', metadata: 'read' } });
  assert.deepStrictEqual(bodies[1].repositories, ['api']);

  app.forgetInstallation(77);
  assert.strictEqual(await app.getInstallationToken(77, { repo: 'web' }), 'tok-3');
});

test('a client whose cached token is rejected mints a fresh one and retries once', async () => {
  let mints = 0;
  let dataCalls = 0;
  const realFetch = global.fetch;
  const fetchImpl = async () => {
    mints += 1;
    return jsonResponse({ token: `tok-${mints}`, expires_at: new Date(Date.now() + 3600e3).toISOString() });
  };
  global.fetch = async (url, opts) => {
    dataCalls += 1;
    const ok = opts.headers.Authorization === 'Bearer tok-2';
    return {
      ok,
      status: ok ? 200 : 401,
      headers: { get: () => null },
      json: async () => ({ private: true }),
      text: async () => 'Bad credentials',
    };
  };
  try {
    const app = createGithubApp(CONFIG, { fetchImpl });
    const client = app.clientForInstallation(77, { repo: 'web' });
    assert.deepStrictEqual(await client.fetchRepoMeta('acme', 'web'), { private: true });
    assert.strictEqual(mints, 2);
    assert.strictEqual(dataCalls, 2);
  } finally {
    global.fetch = realFetch;
  }
});

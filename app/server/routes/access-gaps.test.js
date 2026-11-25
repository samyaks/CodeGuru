'use strict';

// HTTP-level checks that analyses, their Railway links and deploy streams
// answer only their owner (and project members, to read an analysis).
// Needs the real express (CI installs it); skipped where only a stub exists.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

const realExpress = typeof express === 'function' && typeof express().listen === 'function';
const skip = !realExpress && !process.env.CI ? 'needs the real express' : false;

const analysesRows = new Map();
const projectRows = new Map();
const updates = [];
const fakeDb = {
  analyses: {
    findById: async (id) => analysesRows.get(id) || null,
    list: async ({ userId }) => [...analysesRows.values()].filter((a) => !userId || a.user_id === userId),
    update: async (id, fields) => { updates.push({ id, fields }); },
    getRollups: async () => ({}),
  },
  analysisFiles: { countByTier: async () => [] },
  analysisLlmCalls: { aggregateByPhase: async () => [] },
  deployments: { findById: async (id) => projectRows.get(id) || null },
};

function loadRoutes() {
  const dbPath = path.join(__dirname, '..', 'lib', 'db.js');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: new Proxy(fakeDb, { get: (t, k) => (k in t ? t[k] : {}) }) };
  return {
    analyze: require('./analyze'),
    railway: require('./railway').router,
    railwayCallback: require('./railway').callbackRouter,
    deploy: require('./deploy'),
  };
}

async function withServer(fn) {
  const { AppError } = require('../lib/app-error');
  const routes = loadRoutes();
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use((req, _res, next) => {
    const id = req.get('x-test-user');
    req.user = id ? { id } : null;
    req.memberProjectIds = new Set((req.get('x-test-member-of') || '').split(',').filter(Boolean));
    next();
  });
  app.use('/api/analyze', routes.analyze);
  app.use('/api/railway', routes.railway);
  app.use('/auth/railway', routes.railwayCallback);
  app.use('/api/deploy', routes.deploy);
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { as, memberOf, cookie } = {}) => {
    const ctrl = new AbortController();
    const res = await fetch(base + p, {
      method,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { ...(as ? { 'x-test-user': as } : {}), ...(memberOf ? { 'x-test-member-of': memberOf } : {}), ...(cookie ? { cookie } : {}) },
    });
    const isStream = (res.headers.get('content-type') || '').includes('text/event-stream');
    const json = isStream ? null : await res.json().catch(() => null);
    if (isStream) ctrl.abort();
    return { status: res.status, json, isStream };
  };
  try {
    await fn({ call });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('analyses answer only their owner, members can read, and tokens stay on the server', { skip }, async () => {
  analysesRows.set('a1', { id: 'a1', user_id: 'olive', repo_url: 'https://github.com/acme/web', status: 'complete', railway_access_token: 'secret', railway_refresh_token: 'secret2' });
  analysesRows.set('anon', { id: 'anon', user_id: null, status: 'complete' });
  await withServer(async ({ call }) => {
    assert.strictEqual((await call('GET', '/api/analyze/a1')).status, 404);
    assert.strictEqual((await call('GET', '/api/analyze/a1', { as: 'eve' })).status, 404);
    const mine = await call('GET', '/api/analyze/a1', { as: 'olive' });
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.json.railway_access_token, undefined);
    assert.strictEqual(mine.json.railway_refresh_token, undefined);
    assert.strictEqual((await call('GET', '/api/analyze/a1', { as: 'sam', memberOf: 'a1' })).status, 200);

    assert.strictEqual((await call('GET', '/api/analyze/a1/stream')).status, 404);
    assert.strictEqual((await call('GET', '/api/analyze/a1/capture', { as: 'eve' })).status, 404);
    assert.strictEqual((await call('GET', '/api/analyze/a1/stream', { as: 'olive' })).isStream, true);
    assert.strictEqual((await call('GET', '/api/analyze/anon')).status, 200, 'signed-out analyses stay open by link');

    // Signed out, the list is empty, not everyone's.
    assert.deepStrictEqual((await call('GET', '/api/analyze')).json, []);
    assert.deepStrictEqual((await call('GET', '/api/analyze', { as: 'olive' })).json.map((a) => a.id), ['a1']);
  });
});

test('Railway links: members can see status, only the owner connects or disconnects', { skip }, async () => {
  analysesRows.set('a2', { id: 'a2', user_id: 'olive', owner: 'acme', repo: 'web' });
  await withServer(async ({ call }) => {
    assert.strictEqual((await call('GET', '/api/railway/status/a2', { as: 'eve' })).status, 404);
    assert.deepStrictEqual((await call('GET', '/api/railway/status/a2', { as: 'sam', memberOf: 'a2' })).json, { connected: false });
    assert.strictEqual((await call('DELETE', '/api/railway/disconnect/a2', { as: 'eve' })).status, 404);
    assert.strictEqual((await call('DELETE', '/api/railway/disconnect/a2', { as: 'sam', memberOf: 'a2' })).status, 403);
    assert.strictEqual((await call('POST', '/api/railway/relookup/a2', { as: 'sam', memberOf: 'a2' })).status, 403);
    // A forged nonce cookie can't finish the OAuth flow onto someone else's analysis.
    process.env.RAILWAY_CLIENT_ID ||= 'x'; process.env.RAILWAY_CLIENT_SECRET ||= 'y'; process.env.RAILWAY_OAUTH_REDIRECT_URL ||= 'http://127.0.0.1/cb';
    const forged = await call('GET', '/auth/railway/callback?code=c&state=a2.n1', { as: 'eve', cookie: 'railway_oauth_nonce_a2=n1' });
    assert.strictEqual(forged.status, 404);
    assert.strictEqual(updates.length, 0, 'nothing changed');
    assert.strictEqual((await call('DELETE', '/api/railway/disconnect/a2', { as: 'olive' })).status, 200);
  });
});

test('only the owner can watch a deploy stream', { skip }, async () => {
  projectRows.set('p1', { id: 'p1', user_id: 'olive', status: 'failed', error: 'boom', build_logs: 'SECRET=1' });
  projectRows.set('p0', { id: 'p0', user_id: null, status: 'pending' });
  // Watching a live or failed deploy replays its last event, which arms a
  // five-minute buffer timer; the owner's happy path uses a pending deploy.
  projectRows.set('p2', { id: 'p2', user_id: 'olive', status: 'building' });
  await withServer(async ({ call }) => {
    assert.strictEqual((await call('GET', '/api/deploy/p1/stream', { as: 'eve' })).status, 403);
    assert.strictEqual((await call('GET', '/api/deploy/p1/stream', { as: 'sam', memberOf: 'p1' })).status, 403);
    assert.strictEqual((await call('GET', '/api/deploy/p0/stream', { as: 'eve' })).status, 403);
    assert.strictEqual((await call('GET', '/api/deploy/p2/stream', { as: 'olive' })).isStream, true);
  });
});

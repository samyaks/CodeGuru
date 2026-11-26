'use strict';

// HTTP-level checks for the drift review routes, with in-memory stores.
// Needs the real express (CI installs it); skipped where only a stub exists.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createDriftRoutes } = require('./drift');
const { setup } = require('../services/drift/test-fakes');
const { AppError } = require('../lib/app-error');

const realExpress = typeof express === 'function' && typeof express().listen === 'function';
const skip = !realExpress && !process.env.CI ? 'needs the real express' : false;

async function withServer(fn) {
  const ctx = setup();
  const deps = { ...ctx.deps, deployments: { async findById(id) { return id === 'p1' ? ctx.project : null; } } };
  const app = express();
  app.use(express.json());
  // Stand-in for requireAuth + the memberships middleware.
  app.use((req, _res, next) => {
    req.user = ctx.people[req.get('x-test-user')] || null;
    req.memberProjectIds = new Set(req.user && ctx.memberRows.some((m) => m.user_id === req.user.id) ? ['p1'] : []);
    next();
  });
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Login required' }));
  app.use('/api/projects/:id/drift', requireUser, createDriftRoutes({ deps }));
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { as, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(as ? { 'x-test-user': as } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  try {
    await fn({ call, ...ctx });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('review, send back and accept a drifting PR through the HTTP routes', { skip }, async () => {
  await withServer(async ({ call, gh }) => {
    const base = '/api/projects/p1/drift';
    assert.strictEqual((await call('GET', base)).status, 401);
    assert.strictEqual((await call('GET', base, { as: 'rex' })).status, 403);
    assert.strictEqual((await call('GET', '/api/projects/nope/drift', { as: 'owner' })).status, 404);

    const list = await call('GET', base, { as: 'olive' });
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.json.reviews.map((r) => r.prNumber), [7]);

    const review = await call('GET', `${base}/7`, { as: 'olive' });
    assert.strictEqual(review.status, 200);
    assert.strictEqual(review.json.check.verdict, 'drifts');
    assert.strictEqual(review.json.you.canWrite, false);
    assert.strictEqual((await call('GET', `${base}/8`, { as: 'olive' })).status, 404);

    const headSha = review.json.check.headSha;
    const empty = await call('POST', `${base}/7/send-back`, { as: 'owner', body: { headSha, note: '' } });
    assert.strictEqual(empty.status, 400);

    const sent = await call('POST', `${base}/7/send-back`, { as: 'owner', body: { headSha, note: 'Keep the trial free.' } });
    assert.strictEqual(sent.status, 200);
    assert.strictEqual(sent.json.status, 'done');
    assert.strictEqual(gh.comments.length, 1);

    const rec = await call('POST', `${base}/7/accept`, {
      as: 'olive', body: { headSha, edits: [{ op: 'remove', target: { kind: 'never', area: 'billing', text: 'Charge before the trial ends.' } }] },
    });
    assert.strictEqual(rec.status, 200);
    assert.strictEqual(rec.json.status, 'recommended');

    const retry = await call('POST', `${base}/decisions/${rec.json.decision.id}/retry`, { as: 'owner' });
    assert.strictEqual(retry.status, 409, 'a waiting decision is confirmed through its recommendation, not retried');
  });
});

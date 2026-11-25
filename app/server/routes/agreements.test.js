'use strict';

// HTTP-level checks for the agreement routes, with in-memory stores.
// Needs the real express (CI installs it); skipped where only a stub exists.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createAgreementRoutes } = require('./agreements');
const { setup } = require('../services/agreements/test-fakes');
const { AppError } = require('../lib/app-error');

const realExpress = typeof express === 'function' && typeof express().listen === 'function';
const skip = !realExpress && !process.env.CI ? 'needs the real express' : false;

async function withServer(fn) {
  const ctx = setup({ members: ['owner', 'olive'] });
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
  app.use('/api/projects/:id/agreements', requireUser, createAgreementRoutes({ deps }));
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

test('propose, vote and commit an agreement through the HTTP routes', { skip }, async () => {
  await withServer(async ({ call, repo }) => {
    const base = '/api/projects/p1/agreements';
    assert.strictEqual((await call('GET', base)).status, 401);
    assert.strictEqual((await call('GET', base, { as: 'rex' })).status, 403);
    assert.strictEqual((await call('GET', '/api/projects/nope/agreements', { as: 'owner' })).status, 404);

    const empty = await call('GET', base, { as: 'olive' });
    assert.strictEqual(empty.status, 200);
    assert.deepStrictEqual(empty.json.agreements, []);
    assert.deepStrictEqual(empty.json.areas, [{ id: 'billing', name: 'Billing' }]);
    assert.strictEqual(empty.json.emailsOn, true);

    assert.strictEqual((await call('POST', base, { as: 'olive', body: { text: '' } })).status, 400);
    const proposed = await call('POST', base, { as: 'olive', body: { text: 'One deploy a day.' } });
    assert.strictEqual(proposed.status, 201);
    const id = proposed.json.agreement.id;

    assert.strictEqual((await call('POST', `${base}/${id}/vote`, { as: 'owner', body: { vote: 'maybe' } })).status, 400);
    assert.strictEqual((await call('POST', `${base}/${id}/withdraw`, { as: 'owner' })).status, 403);
    assert.strictEqual((await call('POST', `${base}/agr_nope/vote`, { as: 'owner', body: { vote: 'agree' } })).status, 404);
    const voted = await call('POST', `${base}/${id}/vote`, { as: 'owner', body: { vote: 'agree' } });
    assert.strictEqual(voted.status, 200);
    assert.strictEqual(voted.json.agreement.status, 'accepted');
    assert.strictEqual(voted.json.agreement.commit.state, 'committed');
    assert.strictEqual(repo.log.length, 1);

    assert.strictEqual((await call('POST', `${base}/${id}/decide`, { as: 'owner', body: { outcome: 'accept', note: 'x' } })).status, 409);
    assert.strictEqual((await call('POST', `${base}/${id}/retry-commit`, { as: 'owner' })).status, 409);

    const list = await call('GET', base, { as: 'olive' });
    assert.strictEqual(list.json.agreements.length, 1);
    assert.strictEqual(list.json.agreements[0].you.vote, 'agree');
  });
});

'use strict';

// HTTP-level checks for the overview and decision log routes, with in-memory
// stores. Needs the real express (CI installs it); skipped where only a stub exists.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createOverviewRoutes } = require('./overview');
const { setup } = require('../services/drift/test-fakes');
const { AppError } = require('../lib/app-error');

const realExpress = typeof express === 'function' && typeof express().listen === 'function';
const skip = !realExpress && !process.env.CI ? 'needs the real express' : false;

async function withServer(fn) {
  const ctx = setup();
  const agreements = [{
    project_id: 'p1', id: 'agr_1', area_id: null, text: 'Write errors in plain words.', status: 'accepted', proposed_by: 'olive',
    proposed_at: '2026-11-24T10:00:00Z', decided_by: 'owner', decided_at: '2026-11-25T09:00:00Z', decided_via: 'everyone_agreed',
  }];
  const deps = {
    ...ctx.deps,
    deployments: { async findById(id) { return id === 'p1' ? ctx.project : null; } },
    readIntent: async () => ({ ok: true, reason: null, branch: 'main', areas: [] }),
    agreements: { async list() { return agreements; } },
    agreementVotes: { async listFor() { return []; } },
    prCache: null,
    openPrCache: null,
    now: () => new Date('2026-11-27T08:00:00Z'),
  };
  ctx.client.fetchRepoPulls = async () => [{ number: 7, title: 'Charge at signup', html_url: 'https://github.com/acme/web/pull/7', user: { login: 'olivegh' }, head: { sha: 'a1a1a1a1' } }];
  const app = express();
  app.use((req, _res, next) => {
    req.user = ctx.people[req.get('x-test-user')] || null;
    req.memberProjectIds = new Set(req.user && ctx.memberRows.some((m) => m.user_id === req.user.id) ? ['p1'] : []);
    next();
  });
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Login required' }));
  app.use('/api/projects/:id/overview', requireUser, createOverviewRoutes({ deps }));
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, as) => {
    const res = await fetch(base + path, { headers: as ? { 'x-test-user': as } : {} });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, headers: res.headers, text, json };
  };
  try {
    await fn({ call, ...ctx });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the overview and decision log routes need a member, and the log downloads as Markdown', { skip }, async () => {
  await withServer(async ({ call }) => {
    const base = '/api/projects/p1/overview';
    assert.strictEqual((await call(base)).status, 401);
    assert.strictEqual((await call(base, 'rex')).status, 403);
    assert.strictEqual((await call('/api/projects/nope/overview', 'owner')).status, 404);

    const o = await call(base, 'olive');
    assert.strictEqual(o.status, 200);
    assert.strictEqual(o.headers.get('cache-control'), 'private, no-store');
    assert.deepStrictEqual(o.json.pullRequests.map((p) => [p.prNumber, p.verdict, p.yours]), [[7, 'drifts', true]]);
    assert.strictEqual(o.json.recentDecisions[0].id, 'agr_1');

    const log = await call(`${base}/decisions`, 'olive');
    assert.deepStrictEqual(log.json.entries.map((e) => e.id), ['agr_1']);

    const md = await call(`${base}/decisions.md`, 'olive');
    assert.strictEqual(md.status, 200);
    assert.match(md.headers.get('content-type'), /^text\/markdown/);
    assert.strictEqual(md.headers.get('content-disposition'), 'attachment; filename="takeoff-decisions-web-2026-11-27.md"');
    assert.match(md.text, /^# Decision log: acme\/web/);
    assert.match(md.text, /\*\*Agreement accepted\*\* \(everyone agreed\): Write errors in plain words\./);
    assert.strictEqual((await call(`${base}/decisions.md`, 'rex')).status, 403);
  });
});

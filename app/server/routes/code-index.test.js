'use strict';

// HTTP checks for /api/projects/:id/code-index with in-memory stand-ins.
// Needs the real express (CI installs it); skipped where only a stub exists.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createCodeIndexRoutes } = require('./code-index');
const { AppError } = require('../lib/app-error');

const realExpress = typeof express === 'function' && (() => { try { return typeof express().listen === 'function'; } catch { return false; } })();
const skip = !realExpress && !process.env.CI ? 'needs the real express' : false;

async function withServer(fn, { enabled = true, project = { id: 'p1', user_id: 'owner', owner: 'acme', repo: 'shop' } } = {}) {
  const rebuilds = [];
  const row = {
    repo: 'acme/shop', branch: 'main', indexed_sha: 'abc123', status: 'ready', file_count: 12, text_bytes: '3400',
    skipped_count: 2, last_full_at: '2026-11-27T08:00:00Z', last_update_at: null, error: 'old', working: false,
    content: 'SECRET TEXT THAT MUST NOT LEAK',
  };
  const deps = {
    enabled: () => enabled,
    deployments: { async findById(id) { return id === project.id ? project : null; } },
    store: { async status(id) { return id === 'p1' ? row : null; } },
    index: { async rebuild(p) { rebuilds.push(p.id); return { status: 'ready' }; } },
  };
  const people = { owner: { id: 'owner' }, member: { id: 'member' }, stranger: { id: 'stranger' } };
  const app = express();
  app.use((req, _res, next) => {
    req.user = people[req.get('x-test-user')] || null;
    req.memberProjectIds = new Set(req.user && req.user.id === 'member' ? ['p1'] : []);
    next();
  });
  app.use('/api/projects/:id/code-index', createCodeIndexRoutes({ deps }));
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, as) => {
    const res = await fetch(base + path, { method, headers: as ? { 'x-test-user': as } : {} });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, text, json };
  };
  try { await fn({ call, rebuilds }); } finally { await new Promise((r) => server.close(r)); }
}

test('members see the index status, with no file text', { skip }, async () => {
  await withServer(async ({ call }) => {
    for (const who of ['owner', 'member']) {
      const r = await call('GET', '/api/projects/p1/code-index', who);
      assert.strictEqual(r.status, 200, who);
      assert.deepStrictEqual(r.json, {
        status: 'ready', working: false, branch: 'main', indexedSha: 'abc123', fileCount: 12, textBytes: 3400,
        skippedCount: 2, lastFullAt: '2026-11-27T08:00:00Z', lastUpdateAt: null, error: null,
      });
      assert.ok(!r.text.includes('SECRET'));
    }
    assert.strictEqual((await call('GET', '/api/projects/p1/code-index', 'stranger')).status, 403);
    assert.strictEqual((await call('GET', '/api/projects/p1/code-index')).status, 401);
    assert.strictEqual((await call('GET', '/api/projects/nope/code-index', 'owner')).status, 404);
  });
});

test('only the owner can rebuild, a few times an hour', { skip }, async () => {
  await withServer(async ({ call, rebuilds }) => {
    assert.strictEqual((await call('POST', '/api/projects/p1/code-index/rebuild', 'member')).status, 403);
    assert.strictEqual((await call('POST', '/api/projects/p1/code-index/rebuild', 'stranger')).status, 403);
    for (let i = 0; i < 3; i += 1) assert.strictEqual((await call('POST', '/api/projects/p1/code-index/rebuild', 'owner')).status, 202);
    assert.strictEqual((await call('POST', '/api/projects/p1/code-index/rebuild', 'owner')).status, 429);
    assert.deepStrictEqual(rebuilds, ['p1', 'p1', 'p1']);
  });
});

test('nothing is served while Ask is off, or for a project with no owner', { skip }, async () => {
  await withServer(async ({ call }) => {
    assert.strictEqual((await call('GET', '/api/projects/p1/code-index', 'owner')).status, 404);
  }, { enabled: false });
  await withServer(async ({ call, rebuilds }) => {
    assert.strictEqual((await call('GET', '/api/projects/p1/code-index', 'owner')).status, 404);
    assert.strictEqual((await call('POST', '/api/projects/p1/code-index/rebuild', 'owner')).status, 404);
    assert.deepStrictEqual(rebuilds, []);
  }, { project: { id: 'p1', user_id: null, owner: 'acme', repo: 'shop' } });
});

'use strict';

// HTTP-level checks for the team and invite routes, with in-memory stores.
// Needs the real express (CI installs it); skipped where only a stub exists.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createTeamRoutes } = require('./team');
const { createInviteRoutes } = require('./invites');
const { fakeDb } = require('../services/team/test-fakes');
const { AppError } = require('../lib/app-error');

const realExpress = typeof express === 'function' && typeof express().listen === 'function';
const skip = !realExpress && !process.env.CI ? 'needs the real express' : false;

const USERS = {
  owner: { id: 'owner', email: 'owner@acme.test', email_confirmed_at: 'x', user_metadata: { full_name: 'Olive Owner' } },
  sam: { id: 'sam', email: 'sam@acme.test', email_confirmed_at: 'x', user_metadata: {} },
  eve: { id: 'eve', email: 'eve@evil.test', email_confirmed_at: 'x', user_metadata: {} },
};

async function withServer(fn) {
  const db = fakeDb();
  const app = express();
  app.use(express.json());
  // Stand-in for optionalAuth + the memberships middleware.
  app.use(async (req, _res, next) => {
    req.user = USERS[req.get('x-test-user')] || null;
    req.memberProjectIds = new Set(req.user ? await db.deps.projectMembers.projectIdsForUser(req.user.id) : []);
    next();
  });
  const deps = { ...db.deps, committing: { recommendations: db.deps.recommendations, userGithubLinks: db.deps.userGithubLinks, newId: db.deps.newId, clientForInstallation: () => ({ fetchCollaboratorPermission: async () => ({ permission: 'admin', canPush: true, githubUserId: null }) }) } };
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Login required' }));
  app.use('/api/projects/:id/team', requireUser, createTeamRoutes({ sendSignInLink: db.deps.sendSignInLink, deps }));
  app.use('/api/invites', createInviteRoutes({ sendSignInLink: db.deps.sendSignInLink, deps }));
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
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
  };
  try {
    await fn({ call, db });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('invite, join and see the project through the HTTP routes', { skip }, async () => {
  await withServer(async ({ call, db }) => {
    assert.strictEqual((await call('GET', '/api/projects/p1/team')).status, 401);
    assert.strictEqual((await call('GET', '/api/projects/p1/team', { as: 'eve' })).status, 403);
    assert.strictEqual((await call('GET', '/api/projects/nope/team', { as: 'owner' })).status, 404);

    const made = await call('POST', '/api/projects/p1/team/invites', { as: 'owner', body: { target: 'sam@acme.test' } });
    assert.strictEqual(made.status, 201);
    assert.strictEqual(made.json.emailSent, true);
    const token = made.json.path.split('/').pop();

    const preview = await call('GET', `/api/invites/${token}`);
    assert.strictEqual(preview.status, 200);
    assert.strictEqual(preview.headers.get('cache-control'), 'no-store');
    assert.strictEqual(preview.json.state, 'open');
    assert.strictEqual(preview.json.invitedFor, 's**@acme.test');
    assert.strictEqual((await call('POST', `/api/invites/${token}/accept`, { body: { labels: ['builder'] } })).status, 401);
    assert.strictEqual((await call('POST', `/api/invites/${token}/accept`, { as: 'eve', body: { labels: ['builder'] } })).status, 403);

    const joined = await call('POST', `/api/invites/${token}/accept`, { as: 'sam', body: { labels: ['builder'] } });
    assert.deepStrictEqual([joined.status, joined.json], [200, { projectId: 'p1', alreadyMember: false }]);

    const team = await call('GET', '/api/projects/p1/team', { as: 'sam' });
    assert.strictEqual(team.status, 200);
    assert.deepStrictEqual(team.json.members.map((m) => m.userId), ['owner', 'sam']);
    assert.deepStrictEqual(team.json.recommendations, []);

    const labels = await call('PATCH', '/api/projects/p1/team/me', { as: 'sam', body: { labels: ['creator', 'builder'] } });
    assert.deepStrictEqual(labels.json.labels, ['creator', 'builder']);
    assert.strictEqual((await call('DELETE', '/api/projects/p1/team/members/owner', { as: 'sam' })).status, 400);

    // A member can confirm a pending recommendation (write access faked as admin).
    await db.deps.userGithubLinks.upsert('sam', { githubUserId: 5, githubLogin: 'sam-gh' });
    const committing = require('../services/team/committing');
    committing.registerCommittingAction('test.route', { summarize: () => 'Route test', run: async () => ({ ok: true }) });
    await db.deps.recommendations.create({ id: 'r1', projectId: 'p1', actionType: 'test.route', payload: {}, summary: 'Route test', createdBy: 'owner' });
    const confirmed = await call('POST', '/api/projects/p1/team/recommendations/r1/confirm', { as: 'sam' });
    assert.deepStrictEqual([confirmed.status, confirmed.json.recommendation.status], [200, 'confirmed']);
    committing._actions.delete('test.route');

    assert.strictEqual((await call('DELETE', '/api/projects/p1/team/members/sam', { as: 'sam' })).status, 200);
    assert.strictEqual((await call('GET', '/api/projects/p1/team', { as: 'sam' })).status, 403);
    assert.strictEqual((await call('GET', '/api/invites/not-a-token')).status, 404);
  });
});

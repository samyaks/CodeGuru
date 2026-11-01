const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const { createWebhookHandler } = require('./github-webhook');

const APP_SECRET = 'app-secret';
const HOOK_SECRET = 'repo-hook-secret';
const BEFORE = 'a'.repeat(40);
const AFTER = 'b'.repeat(40);

function pushPayload({ installationId = null, ref = 'refs/heads/main', after = AFTER } = {}) {
  return {
    ref,
    before: BEFORE,
    after,
    repository: { full_name: 'acme/web' },
    pusher: { name: 'dev' },
    head_commit: { id: after, message: 'fix(gap:g1): add rate limit\n\nbody' },
    commits: [{ id: after, message: 'fix(gap:g1): add rate limit', added: [], modified: ['server.js'], removed: [] }],
    ...(installationId ? { installation: { id: installationId } } : {}),
  };
}

function delivery(payload, { secret, event = 'push', id = 'd-1' } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = { 'x-github-event': event, 'x-github-delivery': id };
  if (secret) headers['x-hub-signature-256'] = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
  return { body, get: (name) => headers[name.toLowerCase()] };
}

/**
 * In-memory stand-ins for the db layer. The commit_reviews and
 * processed_pushes fakes reproduce their unique indexes (ON CONFLICT DO NOTHING).
 */
function makeWorld({ projects = [{ id: 'p1', user_id: 'u1', branch: 'main', github_installation_id: null }], grants = [] } = {}) {
  const rows = projects.map((p) => ({ ...p }));
  const reviews = new Map();
  const claimed = new Set();
  const calls = { reviewJobs: [], v2: [], archived: [], updates: [], claims: [] };
  const deps = {
    deployments: {
      // A fresh copy per call, as a query would return.
      findByGithubRepo: async () => rows.map((p) => ({ ...p })),
      update: async (id, fields) => {
        calls.updates.push({ id, ...fields });
        Object.assign(rows.find((p) => p.id === id), fields);
      },
    },
    commitReviews: {
      findByProjectAndSha: async (projectId, sha) => reviews.get(`${projectId}:${sha}`) || null,
      create: async (row) => {
        const key = `${row.project_id}:${row.commit_sha}`;
        if (reviews.has(key)) return null;
        reviews.set(key, { ...row });
        return row;
      },
      resetToPending: async () => {},
    },
    webhookEvents: {
      create: async (evt) => {
        calls.archived.push(evt);
        return { id: 'evt' };
      },
    },
    githubRepoAccess: {
      findForUserRepo: async (userId, owner, repo) =>
        grants.find((g) => g.user_id === userId && g.repo_full_name === `${owner}/${repo}`) || null,
    },
    processedPushes: {
      claim: async (push) => {
        calls.claims.push(push);
        const key = [push.projectId, push.ref, push.before, push.after].join('|');
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    },
    runCommitReviewJobSafe: (ctx) => {
      calls.reviewJobs.push({ ...ctx, commitReviewId: '<id>' });
    },
    processPushV2: async ({ project, payload }) => {
      calls.v2.push({ projectId: project.id, ref: payload.ref, after: payload.after, commits: payload.commits.length });
    },
    secrets: () => ({ appSecret: APP_SECRET, repoHookSecret: HOOK_SECRET }),
  };
  return { deps, calls, rows };
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

/** Run a delivery to completion, including the work it defers with setImmediate. */
async function send(handler, req) {
  const res = fakeRes();
  await handler(req, res);
  await new Promise((resolve) => setImmediate(resolve));
  return res;
}

test('an App push delivery runs the same flow as a repo-hook delivery', async () => {
  const viaHook = makeWorld();
  const hookRes = await send(createWebhookHandler(viaHook.deps), delivery(pushPayload(), { secret: HOOK_SECRET }));

  const viaApp = makeWorld();
  const appRes = await send(
    createWebhookHandler(viaApp.deps),
    delivery(pushPayload({ installationId: 42 }), { secret: APP_SECRET }),
  );

  assert.strictEqual(hookRes.statusCode, 202);
  assert.strictEqual(appRes.statusCode, 202);
  assert.strictEqual(viaHook.calls.reviewJobs.length, 1);
  assert.deepStrictEqual(viaApp.calls.reviewJobs, viaHook.calls.reviewJobs);
  assert.deepStrictEqual(viaApp.calls.v2, [{ projectId: 'p1', ref: 'refs/heads/main', after: AFTER, commits: 1 }]);
  assert.deepStrictEqual(viaApp.calls.v2, viaHook.calls.v2);

  assert.deepStrictEqual(viaHook.calls.claims.map((c) => c.source), ['repo_hook']);
  assert.deepStrictEqual(viaApp.calls.claims.map((c) => c.source), ['app']);
  assert.deepStrictEqual(viaHook.calls.archived.map((e) => e.source), ['github']);
  assert.deepStrictEqual(viaApp.calls.archived.map((e) => e.source), ['github_app']);
});

test('duplicate deliveries of one push (repo hook + App) are processed once', async () => {
  const { deps, calls } = makeWorld();
  const handler = createWebhookHandler(deps);
  const [a, b] = await Promise.all([
    send(handler, delivery(pushPayload(), { secret: HOOK_SECRET, id: 'hook-1' })),
    send(handler, delivery(pushPayload({ installationId: 42 }), { secret: APP_SECRET, id: 'app-1' })),
  ]);
  // A late redelivery of the same push is a duplicate too.
  await send(handler, delivery(pushPayload({ installationId: 42 }), { secret: APP_SECRET, id: 'app-1' }));

  assert.strictEqual(a.statusCode, 202);
  assert.strictEqual(b.statusCode, 202);
  assert.strictEqual(calls.reviewJobs.length, 1, 'one commit review');
  assert.strictEqual(calls.v2.length, 1, 'one matcher/verifier + re-analyze schedule');
  assert.strictEqual(calls.archived.length, 3, 'every delivery is still archived');
});

test('the same sha pushed to another branch is a new push', async () => {
  const { deps, calls } = makeWorld();
  const handler = createWebhookHandler(deps);
  await send(handler, delivery(pushPayload({ ref: 'refs/heads/feature' }), { secret: HOOK_SECRET, id: 'd-1' }));
  await send(handler, delivery(pushPayload({ ref: 'refs/heads/main' }), { secret: HOOK_SECRET, id: 'd-2' }));
  assert.deepStrictEqual(calls.v2.map((c) => c.ref), ['refs/heads/feature', 'refs/heads/main']);
});

test('a failed claim write still processes the push', async () => {
  const { deps, calls } = makeWorld();
  deps.processedPushes.claim = async () => { throw new Error('relation "processed_pushes" does not exist'); };
  await send(createWebhookHandler(deps), delivery(pushPayload(), { secret: HOOK_SECRET }));
  assert.strictEqual(calls.v2.length, 1);
});

test('an App push records the installation the project owner granted', async () => {
  const { deps, calls, rows } = makeWorld({
    projects: [{ id: 'p1', user_id: 'u1', branch: 'main', github_installation_id: 7 }],
    grants: [{ user_id: 'u1', repo_full_name: 'acme/web', installation_id: '42' }],
  });
  await send(createWebhookHandler(deps), delivery(pushPayload({ installationId: 42 }), { secret: APP_SECRET }));
  assert.deepStrictEqual(calls.updates, [{ id: 'p1', github_installation_id: 42 }]);
  assert.strictEqual(rows[0].github_installation_id, 42);
});

test('an installation id is not recorded without the owner’s grant, or from a repo-hook signature', async () => {
  const noGrant = makeWorld();
  await send(createWebhookHandler(noGrant.deps), delivery(pushPayload({ installationId: 42 }), { secret: APP_SECRET }));
  assert.deepStrictEqual(noGrant.calls.updates, []);
  assert.strictEqual(noGrant.calls.v2.length, 1, 'the push itself is still processed');

  const forged = makeWorld({ grants: [{ user_id: 'u1', repo_full_name: 'acme/web', installation_id: 42 }] });
  await send(createWebhookHandler(forged.deps), delivery(pushPayload({ installationId: 42 }), { secret: HOOK_SECRET }));
  assert.deepStrictEqual(forged.calls.updates, []);
  assert.deepStrictEqual(forged.calls.claims.map((c) => c.source), ['repo_hook']);
});

test('deliveries signed with neither secret are rejected', async () => {
  const { deps, calls } = makeWorld();
  const res = await send(createWebhookHandler(deps), delivery(pushPayload(), { secret: 'someone-else' }));
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(calls.reviewJobs.length + calls.v2.length + calls.archived.length, 0);
});

test('installation events are acknowledged and archived without touching projects', async () => {
  const { deps, calls } = makeWorld();
  const payload = {
    action: 'added',
    installation: { id: 42, account: { login: 'acme' } },
    repositories_added: [{ full_name: 'acme/web' }],
    repositories_removed: [],
  };
  const res = await send(
    createWebhookHandler(deps),
    delivery(payload, { secret: APP_SECRET, event: 'installation_repositories' }),
  );
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body, { ok: true, logged: 'installation_repositories' });
  assert.deepStrictEqual(calls.archived.map((e) => [e.event_type, e.source]), [['installation_repositories', 'github_app']]);
  assert.strictEqual(calls.reviewJobs.length + calls.v2.length + calls.claims.length, 0);
});

'use strict';

// HTTP-level checks for the Ask routes, with in-memory stores and a fake
// agent. Needs the real express (CI installs it); skipped where only a stub exists.

const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const { createAskRoutes, historyFrom, publicMessage } = require('./ask');
const { AppError } = require('../lib/app-error');

const realExpress = (() => { try { return typeof express().listen === 'function'; } catch { return false; } })();
const skip = !realExpress && !process.env.CI ? 'needs the real express' : false;

const PEOPLE = { owner: { id: 'u-owner' }, mia: { id: 'u-mia' }, rex: { id: 'u-rex' }, ann: { id: 'u-ann' }, bo: { id: 'u-bo' }, cy: { id: 'u-cy' } };
const MEMBERS = new Set(['u-mia', 'u-ann', 'u-bo', 'u-cy']);

function stores() {
  const threads = [];
  const msgs = [];
  let n = 0;
  const id = (p) => `${p}${++n}`;
  const askThreads = {
    async create({ projectId, userId, title }) { const t = { id: id('t'), project_id: projectId, user_id: userId, title, created_at: 'now', updated_at: 'now' }; threads.push(t); return t; },
    async get(pid, uid, tid) { return threads.find((t) => t.id === tid && t.project_id === pid && t.user_id === uid) || null; },
    async listForUser(pid, uid) { return threads.filter((t) => t.project_id === pid && t.user_id === uid); },
    async delete(pid, uid, tid) {
      const i = threads.findIndex((t) => t.id === tid && t.project_id === pid && t.user_id === uid);
      if (i === -1) return false;
      threads.splice(i, 1);
      for (let j = msgs.length - 1; j >= 0; j -= 1) if (msgs[j].thread_id === tid) msgs.splice(j, 1);
      return true;
    },
  };
  const askMessages = {
    verdict: null,
    // As the real one: decide() gets the usage and its verdict says allowed or not.
    async startQuestion({ threadId, projectId, userId, content }, decideFn) {
      const v = this.verdict || decideFn({ questionsToday: 0, spentThisMonth: 0, running: 0, runningMine: 0 });
      if (!v || !v.allowed) return { ok: false, verdict: v };
      const q = { id: id('m'), thread_id: threadId, project_id: projectId, user_id: userId, role: 'user', status: 'done', content };
      const a = { id: id('m'), thread_id: threadId, project_id: projectId, user_id: userId, role: 'assistant', status: 'running', content: '' };
      msgs.push(q, a);
      return { ok: true, question: q, answer: a };
    },
    async listByThread({ projectId, userId, threadId }) { return msgs.filter((m) => m.thread_id === threadId && m.project_id === projectId && m.user_id === userId); },
    async finishAnswer(aid, fields) { const m = msgs.find((x) => x.id === aid); Object.assign(m, fields); return m; },
  };
  return { threads, msgs, askThreads, askMessages };
}

async function withServer(fn, { config = {}, project = { id: 'p1', user_id: 'u-owner', owner: 'acme', repo: 'delta' } } = {}) {
  const s = stores();
  const runs = [];
  const deps = {
    deployments: { async findById(pid) { return pid === 'p1' ? project : null; } },
    askThreads: s.askThreads,
    askMessages: s.askMessages,
    config: () => ({ enabled: true, model: 'claude-opus-5-5', dailyPerMember: 30, monthlyUsd: 20, maxRounds: 8, reserveUsd: 1.5, maxRunningPerMember: 2, maxRunningPerProject: 5, modelPriced: true, ...config }),
    createTools: () => ({}),
    async runQuestion(args) {
      runs.push(args);
      args.onEvent({ type: 'progress', text: 'Reading the plan' });
      return args.deps.askMessages.finishAnswer(args.answer.id, {
        status: 'done', content: 'Billing uses Stripe. [1]',
        sources: [{ n: 1, id: 'plan@x#billing.rules[0]', kind: 'plan', label: 'Plan (takeoff.yaml @ cccccccccccc)' }],
        claims: { paragraphs: [{ text: 'Billing uses Stripe.', refs: [1], code_only: false }], plan_silent: false, not_built: false, suggested_agreement: null, didnt_get_to: null, dropped: 0 },
      });
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = PEOPLE[req.get('x-test-user')] || null;
    req.memberProjectIds = new Set(req.user && MEMBERS.has(req.user.id) ? ['p1'] : []);
    next();
  });
  const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Login required' }));
  app.use('/api/projects/:id/ask', requireUser, createAskRoutes({ deps }));
  app.use((err, _req, res, _next) => {
    if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
    return res.status(500).json({ error: err.message });
  });
  const server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { as, body } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(as ? { 'x-test-user': as } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const type = res.headers.get('content-type') || '';
    const events = type.startsWith('text/event-stream')
      ? text.split('\n\n').filter(Boolean).map((chunk) => JSON.parse(chunk.replace(/^data: /, '')))
      : null;
    let json = null;
    if (!events) { try { json = JSON.parse(text); } catch { json = null; } }
    return { status: res.status, json, events, headers: res.headers };
  };
  try {
    await fn({ call, runs, ...s });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const ASK = '/api/projects/p1/ask';

test('a member asks, follows up, lists, reads and deletes their own threads', { skip }, async () => {
  await withServer(async ({ call, runs }) => {
    const first = await call('POST', ASK, { as: 'mia', body: { question: '  How is billing handled?  ' } });
    assert.strictEqual(first.status, 200);
    assert.match(first.headers.get('content-type'), /^text\/event-stream/);
    assert.strictEqual(first.headers.get('cache-control'), 'no-cache, no-transform');
    assert.deepStrictEqual(first.events.map((e) => e.type), ['started', 'progress', 'answer']);
    const { threadId } = first.events[0];
    const answer = first.events[2].message;
    assert.strictEqual(answer.status, 'done');
    assert.deepStrictEqual(answer.paragraphs, [{ text: 'Billing uses Stripe.', refs: [1], code_only: false }]);
    assert.strictEqual(runs[0].question, 'How is billing handled?');
    assert.deepStrictEqual(runs[0].history, []);

    const second = await call('POST', ASK, { as: 'mia', body: { question: 'And refunds?', threadId } });
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.events[0].threadId, threadId);
    assert.deepStrictEqual(runs[1].history, [{ question: 'How is billing handled?', answer: 'Billing uses Stripe. [1]' }]);

    const list = await call('GET', `${ASK}/threads`, { as: 'mia' });
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.json.threads.map((t) => t.title), ['How is billing handled?']);

    const one = await call('GET', `${ASK}/threads/${threadId}`, { as: 'mia' });
    assert.strictEqual(one.status, 200);
    assert.deepStrictEqual(one.json.messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);

    // Threads are private, even from the owner.
    assert.strictEqual((await call('GET', `${ASK}/threads/${threadId}`, { as: 'owner' })).status, 404);
    assert.deepStrictEqual((await call('GET', `${ASK}/threads`, { as: 'owner' })).json.threads, []);
    assert.strictEqual((await call('POST', ASK, { as: 'ann', body: { question: 'x', threadId } })).status, 404);
    assert.strictEqual((await call('DELETE', `${ASK}/threads/${threadId}`, { as: 'owner' })).status, 404);

    assert.strictEqual((await call('DELETE', `${ASK}/threads/${threadId}`, { as: 'mia' })).status, 200);
    assert.strictEqual((await call('GET', `${ASK}/threads/${threadId}`, { as: 'mia' })).status, 404);
  });
});

test('non-members, unknown projects and signed-out callers get nothing', { skip }, async () => {
  await withServer(async ({ call, runs }) => {
    assert.strictEqual((await call('GET', `${ASK}/threads`)).status, 401);
    assert.strictEqual((await call('GET', `${ASK}/threads`, { as: 'rex' })).status, 404);
    assert.strictEqual((await call('POST', ASK, { as: 'rex', body: { question: 'leak?' } })).status, 404);
    assert.strictEqual((await call('GET', '/api/projects/nope/ask/threads', { as: 'mia' })).status, 404);
    assert.strictEqual(runs.length, 0);
  });
});

test('a project with no owner and Ask turned off both answer 404', { skip }, async () => {
  await withServer(async ({ call }) => {
    assert.strictEqual((await call('POST', ASK, { as: 'mia', body: { question: 'x' } })).status, 404);
  }, { project: { id: 'p1', user_id: null } });
  await withServer(async ({ call }) => {
    assert.strictEqual((await call('GET', `${ASK}/threads`, { as: 'owner' })).status, 404);
  }, { config: { enabled: false } });
});

test('a bad question is refused before anything is stored', { skip }, async () => {
  await withServer(async ({ call, threads, runs }) => {
    assert.strictEqual((await call('POST', ASK, { as: 'ann', body: { question: '   ' } })).status, 400);
    assert.strictEqual((await call('POST', ASK, { as: 'ann', body: { question: 42 } })).status, 400);
    assert.strictEqual((await call('POST', ASK, { as: 'ann', body: { question: 'x'.repeat(4001) } })).status, 400);
    assert.strictEqual((await call('POST', ASK, { as: 'ann', body: { question: 'x', threadId: 'nope' } })).status, 404);
    assert.strictEqual(threads.length, 0);
    assert.strictEqual(runs.length, 0);
  });
});

test('over a limit: 429 with the reason, and the new empty thread is removed', { skip }, async () => {
  await withServer(async ({ call, threads, askMessages, runs }) => {
    askMessages.verdict = { allowed: false, reason: 'monthly_budget', resetsAt: '2026-12-01T00:00:00.000Z' };
    const r = await call('POST', ASK, { as: 'bo', body: { question: 'How is billing handled?' } });
    assert.strictEqual(r.status, 429);
    assert.strictEqual(r.json.reason, 'monthly_budget');
    assert.strictEqual(r.json.resetsAt, '2026-12-01T00:00:00.000Z');
    assert.ok(r.json.error);
    assert.strictEqual(threads.length, 0);
    assert.strictEqual(runs.length, 0);
  });
  await withServer(async ({ call }) => {
    const r = await call('POST', ASK, { as: 'bo', body: { question: 'x' } });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(r.json.reason, 'unpriced_model');
  }, { config: { modelPriced: false } });
});

test('a history that can’t be read still answers, with no history', { skip }, async () => {
  await withServer(async ({ call, runs, askMessages }) => {
    const first = await call('POST', ASK, { as: 'cy', body: { question: 'q1' } });
    const { threadId } = first.events[0];
    const real = askMessages.listByThread;
    askMessages.listByThread = async (scope, opts) => { if (opts && opts.newest) throw new Error('db blip'); return real.call(askMessages, scope, opts); };
    const quiet = console.error; console.error = () => {};
    let r;
    try { r = await call('POST', ASK, { as: 'cy', body: { question: 'q2', threadId } }); } finally { console.error = quiet; }
    assert.deepStrictEqual(r.events.map((e) => e.type), ['started', 'progress', 'answer']);
    assert.deepStrictEqual(runs[1].history, []);
  });
});

test('history skips unfinished answers and the question being asked; public messages carry no stored text', () => {
  const rows = [
    { id: 'm1', role: 'user', content: 'q1' }, { id: 'm2', role: 'assistant', status: 'done', content: 'a1' },
    { id: 'm3', role: 'user', content: 'q2' }, { id: 'm4', role: 'assistant', status: 'failed', content: 'oops' },
    { id: 'm5', role: 'user', content: 'q3' }, { id: 'm6', role: 'assistant', status: 'running', content: '' },
  ];
  assert.deepStrictEqual(historyFrom(rows, new Set(['m5', 'm6'])), [{ question: 'q1', answer: 'a1' }]);
  const pub = publicMessage({ id: 'm2', role: 'assistant', status: 'done', content: 'a1', usage: { secret: 1 }, cost_usd: 3, error: 'x', claims: null, sources: null });
  assert.deepStrictEqual(Object.keys(pub).sort(), ['content', 'createdAt', 'didntGetTo', 'dropped', 'id', 'notBuilt', 'paragraphs', 'planSilent', 'role', 'sources', 'status', 'suggestedAgreement']);
  assert.deepStrictEqual(pub.sources, []);
});

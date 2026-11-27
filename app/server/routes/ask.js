'use strict';

// /api/projects/:id/ask — Ask Takeoff (Milestone 8, PR 4).
// Mounted behind requireAuth + the memberships middleware. Off unless
// TAKEOFF_ASK_ENABLED is set. Threads are private to the person who asked;
// anyone who isn't the owner or a member gets 404, as does a project with
// no owner.
//
//   POST   /                 { question, threadId? } -> an event stream:
//                            started, progress…, answer (or error)
//   GET    /threads          the caller's threads on this project, and which
//                            suggested questions to show them (view)
//   GET    /threads/:tid     one thread with its messages
//   DELETE /threads/:tid

const express = require('express');
const { deployments, askThreads, askMessages, projectMembers } = require('../lib/db');
const { AppError } = require('../lib/app-error');
const { asyncHandler } = require('../lib/async-handler');
const { createRateLimit } = require('../lib/rate-limit');
const { checkProjectAccess } = require('../lib/helpers');
const { askConfig } = require('../services/ask/config');
const { decide, limitMessage } = require('../services/ask/limits');

const byUser = (req) => req.user?.id || req.ip;
const readLimit = createRateLimit({ windowMs: 60000, max: 60, keyFn: byUser, message: 'Too many requests. Try again in a minute.' });
const askLimit = createRateLimit({ windowMs: 60000, max: 6, keyFn: byUser, message: 'You’re asking quickly. Try again in a minute.' });
const deleteLimit = createRateLimit({ windowMs: 60000, max: 30, keyFn: byUser, message: 'Too many requests. Try again in a minute.' });

const MAX_QUESTION = 4000;
const HISTORY_TURNS = 10;
const LIMIT_STATUS = { daily_limit: 429, monthly_budget: 429, user_budget: 429, global_budget: 429, busy: 429, thread_not_found: 404, disabled: 404, unpriced_model: 503 };

/** A message as the client sees it. Sources carry no stored code text. */
function publicMessage(row) {
  const claims = row.claims && typeof row.claims === 'object' ? row.claims : {};
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    content: row.content || '',
    paragraphs: Array.isArray(claims.paragraphs) ? claims.paragraphs : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    planSilent: !!claims.plan_silent,
    notBuilt: !!claims.not_built,
    suggestedAgreement: claims.suggested_agreement || null,
    didntGetTo: claims.didnt_get_to || null,
    dropped: Number(claims.dropped) || 0,
    createdAt: row.created_at,
  };
}

function publicThread(row) {
  return { id: row.id, title: row.title || '', createdAt: row.created_at, updatedAt: row.updated_at };
}

/** Earlier finished question and answer pairs, oldest first. */
function historyFrom(rows, excludeIds) {
  const out = [];
  let pending = null;
  for (const r of rows) {
    if (excludeIds.has(r.id)) continue;
    if (r.role === 'user') pending = r.content;
    else if (r.role === 'assistant' && pending != null) {
      if (r.status === 'done' && r.content) out.push({ question: pending, answer: r.content });
      pending = null;
    }
  }
  return out;
}

/**
 * @param {object} [opts]
 * @param {object} [opts.deps] { deployments, askThreads, askMessages, projectMembers, config, runQuestion, createTools, client } overrides (tests)
 */
function createAskRoutes({ deps = {} } = {}) {
  const router = express.Router({ mergeParams: true });
  const projects = () => deps.deployments || deployments;
  const threads = () => deps.askThreads || askThreads;
  const messages = () => deps.askMessages || askMessages;
  const config = () => (deps.config ? deps.config() : askConfig(process.env));
  const runQuestion = (...a) => (deps.runQuestion || require('../services/ask/agent').runQuestion)(...a);
  const members = () => deps.projectMembers || projectMembers;
  const createTools = deps.createTools || ((project) => require('../services/ask/tools').createAskTools({ project }));

  async function loadProject(req) {
    if (!req.user) throw AppError.unauthorized('Sign in to ask about this project.');
    if (!config().enabled) throw AppError.notFound('Not found');
    const project = await projects().findById(req.params.id);
    if (!project) throw AppError.notFound('Project not found');
    // A project with no owner is open to anyone signed in, so Ask never reads its code.
    if (!project.user_id) throw AppError.notFound('Project not found');
    // While Ask is tried out, it may be on for a few projects only.
    const only = config().projects;
    if (Array.isArray(only) && !only.includes(String(project.id))) throw AppError.notFound('Not found');
    try { checkProjectAccess(project, req); } catch { throw AppError.notFound('Project not found'); }
    return project;
  }

  /** Which suggested questions to show: Creator first, as the overview does. Unknown means creator. */
  async function viewOf(project, userId) {
    try {
      const row = await members().get(project.id, userId);
      const labels = Array.isArray(row && row.labels) ? row.labels : [];
      return !labels.includes('creator') && labels.includes('builder') ? 'builder' : 'creator';
    } catch {
      return 'creator';
    }
  }

  router.get('/threads', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const [rows, view] = await Promise.all([
      threads().listForUser(project.id, req.user.id, { limit: 50 }),
      viewOf(project, req.user.id),
    ]);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ threads: rows.map(publicThread), view });
  }));

  router.get('/threads/:tid', readLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const thread = await threads().get(project.id, req.user.id, req.params.tid);
    if (!thread) throw AppError.notFound('That conversation was not found.');
    const rows = await messages().listByThread({ projectId: project.id, userId: req.user.id, threadId: thread.id });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ thread: publicThread(thread), messages: rows.map(publicMessage) });
  }));

  router.delete('/threads/:tid', deleteLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const ok = await threads().delete(project.id, req.user.id, req.params.tid);
    if (!ok) throw AppError.notFound('That conversation was not found.');
    res.json({ deleted: true });
  }));

  router.post('/', askLimit, asyncHandler(async (req, res) => {
    const project = await loadProject(req);
    const body = req.body || {};
    const question = typeof body.question === 'string' ? body.question.replace(/\u0000/g, '').trim() : '';
    if (!question) throw AppError.badRequest('Ask a question.');
    if (question.length > MAX_QUESTION) throw AppError.badRequest(`Questions can be up to ${MAX_QUESTION} characters.`);
    const cfg = config();

    let thread;
    let created = false;
    if (body.threadId != null && body.threadId !== '') {
      thread = await threads().get(project.id, req.user.id, String(body.threadId));
      if (!thread) throw AppError.notFound('That conversation was not found.');
    } else {
      thread = await threads().create({ projectId: project.id, userId: req.user.id, title: question.slice(0, 120) });
      created = true;
    }

    const started = await messages().startQuestion(
      { threadId: thread.id, projectId: project.id, userId: req.user.id, content: question, reserveUsd: cfg.reserveUsd },
      (usage) => decide(usage, { config: cfg })
    );
    if (!started.ok) {
      if (created) await threads().delete(project.id, req.user.id, thread.id).catch(() => {});
      const v = started.verdict || {};
      return res.status(LIMIT_STATUS[v.reason] || 429).json({ error: limitMessage(v), reason: v.reason || null, resetsAt: v.resetsAt || null });
    }

    // The latest turns only; a history that can't be read just means none.
    const rows = await messages().listByThread({ projectId: project.id, userId: req.user.id, threadId: thread.id }, { limit: 2 * HISTORY_TURNS + 4, newest: true })
      .catch((err) => { console.error('[ask] history read failed:', err && err.message); return []; });
    const history = historyFrom(rows, new Set([started.question.id, started.answer.id]));

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      Connection: 'keep-alive',
    });
    let open = true;
    res.on('close', () => { open = false; });
    const send = (event) => { if (open) { try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { open = false; } } };
    const keepAlive = setInterval(() => send({ type: 'heartbeat' }), 15000);
    keepAlive.unref?.();

    send({ type: 'started', threadId: thread.id, questionId: started.question.id, answerId: started.answer.id });
    try {
      // The answer is finished and saved even if the person closes the page.
      const row = await runQuestion({
        project,
        answer: started.answer,
        question,
        history,
        config: cfg,
        deps: { askMessages: messages(), createTools, client: deps.client },
        onEvent: send,
      });
      send({ type: 'answer', threadId: thread.id, message: publicMessage({ ...started.answer, ...row }) });
    } catch (err) {
      console.error('[ask] question failed:', err && err.message);
      send({ type: 'error', error: 'Takeoff couldn’t answer this. Try asking again.' });
    } finally {
      clearInterval(keepAlive);
      if (open) res.end();
    }
  }));

  return router;
}

module.exports = { createAskRoutes, publicMessage, historyFrom };

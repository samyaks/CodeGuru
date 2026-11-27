'use strict';

/**
 * Ask Takeoff's agent loop (Milestone 8, PR 4).
 *
 * One question: the model reads the project through the read-only tools in
 * ./tools, at most `maxRounds` rounds and 3 tool calls a round, then gives
 * its answer as JSON (structured outputs). The citation check in
 * ./citations removes anything it can't back. Spend is recorded after every
 * model call, so a crash still counts it, and an answer stops once the
 * project's recorded spend reaches its monthly budget.
 *
 * runQuestion never throws: every outcome ends in finishAnswer, with
 * status done, refused or failed.
 */

const { SYSTEM_PROMPT, ANSWER_SCHEMA, contextBlock, toolResultText, FINAL_ROUND_NOTE } = require('./prompt');
const { checkAnswer } = require('./citations');
const { estimateCost } = require('../../lib/model-pricing');

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const SUPPORTS_FALLBACKS = /^claude-(opus-5|fable-5|mythos-5|sonnet-5-5)/;

const LIMITS = Object.freeze({
  maxTokens: 8000,
  inputTokens: 120000,
  toolsPerRound: 3,
  toolCalls: 24,
  historyTurns: 10,
  historyChars: 6000,
});

const MESSAGES = {
  failed: 'Takeoff couldn’t answer this. Try asking again.',
  refused: 'Takeoff can’t answer this question.',
  budget: 'This project reached its Ask Takeoff budget for the month while answering, so the answer stopped. It resets on the first of next month (UTC).',
};

let sharedClient = null;
function defaultClient() {
  if (!sharedClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    sharedClient = new Anthropic({ timeout: 4 * 60 * 1000, maxRetries: 1 });
  }
  return sharedClient;
}

/**
 * Cost of one response. With server-side fallbacks, usage.iterations has an
 * entry per attempt, each billed at its own model's rate; top-level usage
 * covers only the attempt that answered. Declined attempts are counted too
 * (some are not billed), so the recorded cost errs high, never low.
 */
function costOf(response, requestModel) {
  const u = (response && response.usage) || {};
  const tokens = (x) => ({
    inputTokens: Number(x.input_tokens) || 0,
    outputTokens: Number(x.output_tokens) || 0,
    cacheReadTokens: Number(x.cache_read_input_tokens) || 0,
    cacheCreationTokens: Number(x.cache_creation_input_tokens) || 0,
  });
  const its = Array.isArray(u.iterations) && u.iterations.length ? u.iterations : null;
  if (!its) return { cost: estimateCost((response && response.model) || requestModel, tokens(u)), ...tokens(u) };
  let cost = 0;
  const sum = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  for (const it of its) {
    const t = tokens(it);
    const model = it.model || (it.type === 'fallback_message' ? response.model : requestModel) || requestModel;
    cost += estimateCost(model, t);
    for (const k of Object.keys(sum)) sum[k] += t[k];
  }
  return { cost, ...sum };
}

/**
 * Assistant content to send back on the next round. After a fallback, the
 * blocks before the last `fallback` block that the next model can't take
 * (thinking, and tool calls the declined model made) are left out; the
 * `fallback` block itself stays where it was.
 */
function echoContent(content) {
  const blocks = Array.isArray(content) ? content : [];
  let last = -1;
  blocks.forEach((b, i) => { if (b && b.type === 'fallback') last = i; });
  if (last === -1) return blocks;
  const dropBefore = new Set(['thinking', 'redacted_thinking', 'connector_text', 'tool_use']);
  return blocks.filter((b, i) => i >= last || !dropBefore.has(b && b.type));
}

/** What the person sees while it works. Inputs come from the model, so they're shortened. */
function progressText(name, input = {}) {
  const s = (v, n = 60) => {
    const t = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  switch (name) {
    case 'get_plan': return input.area ? `Reading the plan for ${s(input.area, 40)}` : 'Reading the plan';
    case 'rules_for_path': return `Checking which rules cover ${s(input.path)}`;
    case 'get_agreements': return 'Reading the agreements';
    case 'get_decisions': return 'Reading the decision log';
    case 'get_pr_checks': return input.pr ? `Reading the check on PR #${s(input.pr, 10)}` : 'Reading the PR checks';
    case 'get_people': return 'Looking up who is on the project';
    case 'get_capabilities': return 'Reading the confirmed capabilities';
    case 'search_code': return `Searching the code for “${s(input.query, 40)}”`;
    case 'find_symbol': return `Finding where ${s(input.name, 40)} is defined`;
    case 'list_files': return input.path_glob ? `Listing files in ${s(input.path_glob, 40)}` : 'Listing files';
    case 'read_file': return `Reading ${s(input.path)}`;
    case 'find_usages': return `Finding what uses ${s(input.path)}`;
    case 'recent_changes': return 'Reading recent commits';
    default: return 'Looking something up';
  }
}

/** Earlier questions and answers in the thread, as plain text turns. */
function historyMessages(history = []) {
  const turns = [];
  for (const h of history.slice(-LIMITS.historyTurns)) {
    if (!h || !h.question || !h.answer) continue;
    turns.push({ role: 'user', content: String(h.question).slice(0, LIMITS.historyChars) });
    turns.push({ role: 'assistant', content: String(h.answer).slice(0, LIMITS.historyChars) });
  }
  return turns;
}

/**
 * @param {object} args
 * @param {object} args.project the project row (must have an owner)
 * @param {object} args.answer  the 'running' answer row from startQuestion
 * @param {string} args.question
 * @param {Array<{question: string, answer: string}>} [args.history] earlier turns, oldest first
 * @param {object} args.config  askConfig()
 * @param {object} args.deps    { askMessages, createTools, client?, now? }
 * @param {(event: object) => void} [args.onEvent] progress events
 * @returns {Promise<object>} the finished answer row (or a stand-in if it was no longer running)
 */
async function runQuestion({ project, answer, question, history = [], config, deps, onEvent = () => {} }) {
  const emit = (e) => { try { onEvent(e); } catch { /* the stream may be gone */ } };
  const model = config.model;
  const api = deps.client || defaultClient();
  let totalCost = 0;
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, rounds: 0, tool_calls: 0 };
  let servedBy = null;

  const finish = async (fields) => {
    const row = await deps.askMessages.finishAnswer(answer.id, { model: servedBy || model, usage, costUsd: totalCost, ...fields })
      .catch((err) => { console.error(`[ask] finishAnswer failed for ${answer.id}:`, err && err.message); return null; });
    return row || { ...answer, ...fields, status: fields.status };
  };

  let tools;
  try {
    tools = deps.createTools(project);
  } catch (err) {
    return finish({ status: 'failed', content: MESSAGES.failed, error: 'tools_unavailable' });
  }

  try {
    emit({ type: 'progress', text: 'Reading the plan' });
    const plan = await tools.call('get_plan', {});
    const messages = [
      ...historyMessages(history),
      { role: 'user', content: [
        { type: 'text', text: contextBlock(project, plan.ok ? plan.result : null) },
        { type: 'text', text: String(question) },
      ] },
    ];
    // tools render first, then system: the marker caches both, the same for every project.
    const system = [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }];

    for (let round = 1; ; round += 1) {
      const last = round >= config.maxRounds || usage.tool_calls >= LIMITS.toolCalls
        || usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens >= LIMITS.inputTokens;
      const params = {
        model,
        max_tokens: LIMITS.maxTokens,
        system,
        tools: tools.definitions,
        tool_choice: { type: last ? 'none' : 'auto' },
        messages,
        output_config: { format: { type: 'json_schema', schema: ANSWER_SCHEMA }, effort: 'medium' },
        // Automatic caching moves a breakpoint to the end as the loop grows.
        cache_control: { type: 'ephemeral' },
      };
      const response = SUPPORTS_FALLBACKS.test(model)
        ? await api.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        : await api.messages.create(params);

      const c = costOf(response, model);
      totalCost += c.cost;
      usage.rounds = round;
      usage.input_tokens += c.inputTokens;
      usage.output_tokens += c.outputTokens;
      usage.cache_read_input_tokens += c.cacheReadTokens;
      usage.cache_creation_input_tokens += c.cacheCreationTokens;
      if (response && response.model) servedBy = response.model;
      await deps.askMessages.addCost(answer.id, c.cost)
        .catch((err) => console.error(`[ask] addCost failed for ${answer.id}:`, err && err.message));

      const stop = response && response.stop_reason;
      if (stop === 'refusal') return finish({ status: 'refused', content: MESSAGES.refused, error: 'refused' });
      if (stop === 'max_tokens') return finish({ status: 'failed', content: MESSAGES.failed, error: 'max_tokens' });

      const content = Array.isArray(response && response.content) ? response.content : [];
      // Only the calls that will be echoed back: after a fallback, the
      // declined model's tool calls are dropped and must not run.
      const echoed = echoContent(content);
      const calls = echoed.filter((b) => b && b.type === 'tool_use');

      if (stop === 'tool_use' && calls.length && !last) {
        // Stop before another round once the month's budget is used up.
        const spent = await deps.askMessages.usage({ projectId: project.id, userId: answer.user_id })
          .then((u) => u.spentThisMonth).catch(() => 0);
        if (spent >= config.monthlyUsd) return finish({ status: 'failed', content: MESSAGES.budget, error: 'monthly_budget' });

        messages.push({ role: 'assistant', content: echoed });
        const results = [];
        for (let i = 0; i < calls.length; i += 1) {
          const b = calls[i];
          if (i >= LIMITS.toolsPerRound || usage.tool_calls >= LIMITS.toolCalls) {
            results.push({ type: 'tool_result', tool_use_id: b.id, is_error: true,
              content: `Only ${LIMITS.toolsPerRound} lookups run each round. Ask for this one again next round if you still need it.` });
            continue;
          }
          usage.tool_calls += 1;
          emit({ type: 'progress', text: progressText(b.name, b.input || {}) });
          results.push(b);
        }
        // Run the allowed calls side by side; keep the results in call order.
        const done = await Promise.all(results.map(async (r) => {
          if (r.type === 'tool_result') return r;
          const out = await tools.call(r.name, r.input);
          return { type: 'tool_result', tool_use_id: r.id, content: toolResultText(out), ...(out.ok ? {} : { is_error: true }) };
        }));
        const next = round + 1;
        const nextIsLast = next >= config.maxRounds || usage.tool_calls >= LIMITS.toolCalls;
        messages.push({ role: 'user', content: nextIsLast ? [...done, { type: 'text', text: FINAL_ROUND_NOTE }] : done });
        await deps.askMessages.heartbeat(answer.id).catch(() => {});
        continue;
      }

      // The answer: JSON text that the schema shapes.
      const text = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (!parsed || typeof parsed !== 'object') return finish({ status: 'failed', content: MESSAGES.failed, error: 'bad_answer' });

      const checked = checkAnswer(parsed, tools.sources, { project });
      const claims = {
        paragraphs: checked.paragraphs.map(({ text: t, refs, code_only }) => ({ text: t, refs, code_only })),
        dropped: checked.dropped,
        plan_silent: checked.planSilent,
        not_built: checked.notBuilt,
        suggested_agreement: checked.suggestedAgreement,
        didnt_get_to: checked.didntGetTo,
      };
      return finish({ status: 'done', content: checked.content, sources: checked.sources, claims, error: checked.paragraphs.length ? null : 'no_sourced_answer' });
    }
  } catch (err) {
    console.error(`[ask] answer ${answer.id} failed:`, err && (err.status || ''), err && err.message);
    return finish({ status: 'failed', content: MESSAGES.failed, error: 'model_error' });
  }
}

module.exports = { runQuestion, costOf, echoContent, progressText, historyMessages, LIMITS, MESSAGES, FALLBACK_BETA };

#!/usr/bin/env node
'use strict';

/**
 * Ask Takeoff live eval (Milestone 8, PR 4).
 *
 * Asks the real model the golden questions (services/ask/eval-questions.js)
 * over the fixture project the tests use, and reports cost and source
 * accuracy per question, plus whether a follow-up reads from the prompt
 * cache. No database and no GitHub: the project, its index and its stores
 * are the test fakes.
 *
 * THIS SPENDS REAL API MONEY. It does nothing unless you pass --spend and
 * ANTHROPIC_API_KEY is set, and it stops before a question once the run
 * has cost --max-usd (default $3).
 *
 *   node server/scripts/ask-eval.js --spend [--max-usd 3] [--only id,id] [--out file.json]
 */

const fs = require('fs');

function args(argv) {
  const out = { spend: false, maxUsd: 3, only: null, out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--spend') out.spend = true;
    else if (a === '--max-usd') out.maxUsd = Number(argv[++i]);
    else if (a === '--only') out.only = new Set(String(argv[++i] || '').split(',').filter(Boolean));
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isFinite(out.maxUsd) || out.maxUsd <= 0) throw new Error('--max-usd must be a positive number');
  return out;
}

const SECRETS = [/AKIA[0-9A-Z]{16}/, /sk_live_/];

async function main() {
  const opts = args(process.argv.slice(2));
  if (opts.help || !opts.spend) {
    console.log('Ask eval: asks the real model the golden questions and reports cost and source accuracy.');
    console.log('It spends real API money, so it runs only with --spend (and ANTHROPIC_API_KEY set).');
    console.log('Usage: node server/scripts/ask-eval.js --spend [--max-usd 3] [--only id,id] [--out file.json]');
    process.exit(opts.spend ? 0 : 2);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set.');
    process.exit(2);
  }

  const { runQuestion } = require('../services/ask/agent');
  const { askConfig } = require('../services/ask/config');
  const { setup, fakeIndex, fakeGithub, project } = require('../services/ask/tools/test-fakes');
  const { QUESTIONS, ROWS, COMMITS, INJECTED, FOLLOW_UP } = require('../services/ask/eval-questions');

  const base = askConfig(process.env);
  if (!base.modelPriced) { console.error(`No price is known for ${base.model}, so its cost can't be tracked.`); process.exit(2); }
  let spent = 0;
  const config = { ...base, monthlyUsd: opts.maxUsd };

  const fixture = () => setup({
    rows: ROWS,
    gh: fakeGithub({ commits: COMMITS }),
    index: fakeIndex({ rows: Object.entries(INJECTED).map(([p, content]) => ({ path: p, content })) }),
  });

  async function one(question, history = []) {
    const { tools } = fixture();
    let cost = 0;
    const askMessages = {
      async addCost(_id, c) { cost += c; spent += c; },
      async heartbeat() {},
      async usage() { return { spentThisMonth: spent }; },
      async finishAnswer(id, fields) { return { id, ...fields }; },
    };
    const started = Date.now();
    const row = await runQuestion({
      project, question, history, config,
      answer: { id: 'eval', user_id: 'u2', status: 'running' },
      deps: { askMessages, createTools: () => tools },
    });
    return { row, cost, ms: Date.now() - started };
  }

  const results = [];
  for (const q of QUESTIONS) {
    if (opts.only && !opts.only.has(q.id)) continue;
    if (spent >= opts.maxUsd) { results.push({ id: q.id, skipped: `stopped at $${spent.toFixed(4)}` }); continue; }
    const { row, cost, ms } = await one(q.question);
    const kinds = (row.sources || []).map((s) => s.kind);
    const text = JSON.stringify([row.content, row.claims]);
    const checks = {
      answered: row.status === 'done' && !row.error,
      cites_expected_kind: kinds.some((k) => q.kinds.includes(k)),
      flags_right: !q.flags || Object.entries(q.flags).every(([k, v]) => row.claims && row.claims[k] === v),
      no_secret: !SECRETS.some((re) => re.test(text)),
      none_dropped: !(row.claims && row.claims.dropped),
    };
    results.push({
      id: q.id, question: q.question, status: row.status, error: row.error || null,
      cost_usd: Number(cost.toFixed(5)), ms, rounds: row.usage && row.usage.rounds, tool_calls: row.usage && row.usage.tool_calls,
      cache_read_tokens: row.usage && row.usage.cache_read_input_tokens, kinds, checks,
      pass: Object.values(checks).every(Boolean), answer: row.content,
    });
    console.log(`${results[results.length - 1].pass ? 'PASS' : 'FAIL'} ${q.id} $${cost.toFixed(4)} ${kinds.join(',') || '-'}`);
  }

  let followUp = null;
  if (!opts.only && spent < opts.maxUsd) {
    const first = await one(FOLLOW_UP.first);
    const then = first.row.status === 'done'
      ? await one(FOLLOW_UP.then, [{ question: FOLLOW_UP.first, answer: first.row.content }])
      : null;
    followUp = {
      first_cost_usd: Number(first.cost.toFixed(5)),
      then_cost_usd: then ? Number(then.cost.toFixed(5)) : null,
      then_cache_read_tokens: then && then.row.usage ? then.row.usage.cache_read_input_tokens : null,
      hits_cache: !!(then && then.row.usage && then.row.usage.cache_read_input_tokens > 0),
    };
    console.log(`${followUp.hits_cache ? 'PASS' : 'FAIL'} follow-up reads the prompt cache (${followUp.then_cache_read_tokens} tokens)`);
  }

  const asked = results.filter((r) => !r.skipped);
  const summary = {
    model: config.model,
    asked: asked.length,
    passed: asked.filter((r) => r.pass).length,
    source_accuracy: asked.length ? asked.filter((r) => r.checks.cites_expected_kind).length / asked.length : null,
    total_usd: Number(spent.toFixed(4)),
    mean_usd: asked.length ? Number((asked.reduce((s, r) => s + r.cost_usd, 0) / asked.length).toFixed(4)) : null,
    follow_up: followUp,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (opts.out) fs.writeFileSync(opts.out, JSON.stringify({ summary, results }, null, 2));
}

main().catch((err) => { console.error(err && err.message); process.exit(1); });

'use strict';

// One Claude call per check, with structured outputs so the reply is the JSON
// the schema allows. Server-side fallbacks are on: if the model declines, the
// API retries on Anthropic's recommended fallback model inside the same call.

const { VERDICT_SCHEMA } = require('./prompt');
const { VerdictError } = require('./parse');

const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
// `fallbacks: "default"` is only accepted for models that have published
// fallback targets; an override to another model goes without it.
const SUPPORTS_FALLBACKS = /^claude-(opus-5|fable-5|mythos-5|sonnet-5-5)/;

let sharedClient = null;
function defaultClient() {
  if (!sharedClient) {
    const Anthropic = require('@anthropic-ai/sdk');
    sharedClient = new Anthropic({ timeout: 4 * 60 * 1000, maxRetries: 1 });
  }
  return sharedClient;
}

function verdictModel(env = process.env) {
  return env.TAKEOFF_VERDICT_MODEL || DEFAULT_MODEL;
}

/** @returns {Promise<{ text: string, model: string, usage: object|null }>} */
async function callVerdictModel({ system, user }, { client = null, model = verdictModel() } = {}) {
  const params = {
    model,
    max_tokens: 16000,
    // Opus 5.5 defaults to medium effort; a review is worth the extra thought.
    output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA }, effort: 'high' },
    system,
    messages: [{ role: 'user', content: user }],
  };
  const api = client || defaultClient();
  const response = SUPPORTS_FALLBACKS.test(model)
    ? await api.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
    : await api.messages.create(params);
  if (response.stop_reason === 'refusal') {
    throw new VerdictError('refused', 'The model declined to check this PR.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new VerdictError('truncated', 'The model ran out of room before finishing its verdict.');
  }
  // Content can hold thinking and `fallback` blocks; the verdict is the text.
  const text = (Array.isArray(response.content) ? response.content : [])
    .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
  if (!text.trim()) throw new VerdictError('empty', 'The model returned no verdict.');
  return { text, model: response.model || model, usage: response.usage || null };
}

module.exports = { callVerdictModel, verdictModel, DEFAULT_MODEL, FALLBACK_BETA, SUPPORTS_FALLBACKS };

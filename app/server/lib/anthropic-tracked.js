const { analyses, analysisLlmCalls, analysisEvents } = require('./db');

// USD per 1M tokens
const PRICING = {
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4': { input: 0.80, output: 4 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.80, output: 4 },
  default: { input: 3, output: 15 },
};

function estimateCost(model, inputTokens, outputTokens) {
  const lower = String(model || '').toLowerCase();
  let matched = null;
  let matchedLen = -1;
  for (const key of Object.keys(PRICING)) {
    if (key === 'default') continue;
    if (lower.startsWith(key) && key.length > matchedLen) {
      matched = key;
      matchedLen = key.length;
    }
  }
  const rate = matched ? PRICING[matched] : PRICING.default;
  const cost = ((inputTokens || 0) * rate.input + (outputTokens || 0) * rate.output) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}

let _sharedClient = null;
function getSharedClient() {
  if (_sharedClient) return _sharedClient;
  const Anthropic = require('@anthropic-ai/sdk');
  _sharedClient = new Anthropic();
  return _sharedClient;
}

async function recordUsage({ analysisId, phase, model, inputTokens, outputTokens, durationMs, targetPath, filesUsed }) {
  if (!analysisId) return;
  const cost_usd = estimateCost(model, inputTokens, outputTokens);
  try {
    await analysisLlmCalls.create({
      analysis_id: analysisId,
      phase,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd,
      duration_ms: durationMs,
      target_path: targetPath || null,
      files_used: filesUsed || null,
    });
    await analyses.incrementLlm(analysisId, {
      calls: 1,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd,
    });
    await analysisEvents.create({
      analysis_id: analysisId,
      event_type: 'llm.call',
      source: 'anthropic',
      path: targetPath || null,
      tokens: (inputTokens || 0) + (outputTokens || 0),
      metadata: {
        phase,
        model,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd,
        duration_ms: durationMs,
      },
    });
  } catch (err) {
    console.error(`[anthropic-tracked] failed to record usage for phase=${phase}: ${err.message}`);
  }
}

async function createMessageTracked({
  client,
  analysisId,
  phase,
  targetPath,
  filesUsed,
  params,
}) {
  const started = Date.now();
  const response = await (client || getSharedClient()).messages.create(params);
  const duration_ms = Date.now() - started;
  const inputTokens = response?.usage?.input_tokens || 0;
  const outputTokens = response?.usage?.output_tokens || 0;
  const model = params?.model || 'unknown';
  await recordUsage({
    analysisId,
    phase,
    model,
    inputTokens,
    outputTokens,
    durationMs: duration_ms,
    targetPath,
    filesUsed,
  });
  return response;
}

// Streaming wrapper. Matches the existing pattern in context-generator.js:
// uses `messages.create({ ...params, stream: true })` and iterates events via
// `for await`. Calls `onText(chunk, fullText)` for each text delta, then
// records usage after the stream completes. Returns { text, usage, model, durationMs }.
async function streamMessageTracked({
  client,
  analysisId,
  phase,
  targetPath,
  filesUsed,
  params,
  onText,
}) {
  const started = Date.now();
  const streamParams = { ...params, stream: true };
  const stream = await (client || getSharedClient()).messages.create(streamParams);

  let fullText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const event of stream) {
    if (event.type === 'message_start' && event.message?.usage) {
      if (typeof event.message.usage.input_tokens === 'number') {
        inputTokens = event.message.usage.input_tokens;
      }
      if (typeof event.message.usage.output_tokens === 'number') {
        outputTokens = event.message.usage.output_tokens;
      }
    } else if (event.type === 'content_block_delta' && event.delta?.text) {
      const chunk = event.delta.text;
      fullText += chunk;
      if (onText) {
        try {
          onText(chunk, fullText);
        } catch (err) {
          console.error(`[anthropic-tracked] onText callback threw for phase=${phase}: ${err.message}`);
        }
      }
    } else if (event.type === 'message_delta' && event.usage) {
      if (typeof event.usage.input_tokens === 'number') {
        inputTokens = event.usage.input_tokens;
      }
      if (typeof event.usage.output_tokens === 'number') {
        outputTokens = event.usage.output_tokens;
      }
    }
  }

  const durationMs = Date.now() - started;
  const model = params?.model || 'unknown';
  await recordUsage({
    analysisId,
    phase,
    model,
    inputTokens,
    outputTokens,
    durationMs,
    targetPath,
    filesUsed,
  });

  return {
    text: fullText,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    model,
    durationMs,
  };
}

module.exports = {
  createMessageTracked,
  streamMessageTracked,
  estimateCost,
  PRICING,
  getSharedClient,
};

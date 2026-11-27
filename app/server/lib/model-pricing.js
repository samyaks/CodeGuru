/**
 * Model prices, USD per 1M tokens, and the cost estimate built on them.
 * No database or SDK dependency, so cap checks and tests can use it alone.
 * Prices other than those below fall back to $3/$15 (see hasPrice).
 */

// USD per 1M tokens — keys matched longest-prefix. Keep dated model ids
// explicit so `claude-sonnet-5` / `claude-haiku-4-5` do not silently fall
// through to a wrong bucket.
//
// Sonnet 5: Anthropic introductory $2/$10 through 2026-08-31, then $3/$15.
// Haiku 4.5: $1/$5 (not the retired Haiku 3.5 $0.80/$4 rates).
// Opus 5.5 / Sonnet 5.5 bill cache reads at 0.05x input, so they carry an
// explicit cacheRead rate. Haiku 5.5 is $0.10/$0.50 up to 100K prompt
// tokens; longer prompts cost more and are estimated low here.
const PRICING = {
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.20 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5-2': { input: 8, output: 40, cacheRead: 0.20 },
  'claude-mythos-5-1': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-opus-4': { input: 15, output: 75 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.10 },
  'claude-haiku-5-5': { input: 0.10, output: 0.50 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-sonnet-4': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-haiku-4': { input: 0.80, output: 4 },
  'claude-3-5-sonnet': { input: 3, output: 15 },
  'claude-3-5-haiku': { input: 0.80, output: 4 },
  default: { input: 3, output: 15 },
};

/** Sonnet 5 intro window ends 2026-09-01 UTC. */
const SONNET5_INTRO_ENDS_MS = Date.UTC(2026, 8, 1);

function resolveRate(modelKey) {
  if (modelKey === 'claude-sonnet-5' && Date.now() < SONNET5_INTRO_ENDS_MS) {
    return { input: 2, output: 10 };
  }
  return PRICING[modelKey] || PRICING.default;
}

/** The PRICING key a model id falls under (longest prefix), or null. */
function pricingKey(model) {
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
  return matched;
}

/** True when the model has its own price (not the $3/$15 fallback). */
function hasPrice(model) {
  return pricingKey(model) !== null;
}

function estimateCost(model, { inputTokens = 0, cacheCreationTokens = 0, cacheReadTokens = 0, outputTokens = 0 } = {}) {
  const matched = pricingKey(model);
  const rate = matched ? resolveRate(matched) : PRICING.default;
  // Anthropic billing multipliers for prompt-caching buckets:
  //   cache writes  = 1.25x base input rate
  //   cache reads   = 0.10x base input rate, unless the model sets cacheRead
  const cost = (
    (inputTokens || 0)         * rate.input         +
    (cacheCreationTokens || 0) * rate.input * 1.25  +
    (cacheReadTokens || 0)     * (rate.cacheRead != null ? rate.cacheRead : rate.input * 0.10) +
    (outputTokens || 0)        * rate.output
  ) / 1_000_000;
  return Math.round(cost * 10000) / 10000;
}

module.exports = { PRICING, resolveRate, estimateCost, pricingKey, hasPrice };

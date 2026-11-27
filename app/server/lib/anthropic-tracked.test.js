const { test } = require('node:test');
const assert = require('node:assert');

const { extractText, estimateCost } = require('./anthropic-tracked');
const { hasPrice } = require('./model-pricing');

test('extractText returns the first text block', () => {
  const resp = { content: [{ type: 'text', text: 'hello' }] };
  assert.strictEqual(extractText(resp), 'hello');
});

test('extractText skips a leading thinking block (sonnet-5)', () => {
  const resp = {
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: '["Auth","Billing"]' },
    ],
  };
  assert.strictEqual(extractText(resp), '["Auth","Billing"]');
});

test('extractText tolerates missing/blank content', () => {
  assert.strictEqual(extractText({ content: [] }), '');
  assert.strictEqual(extractText({}), '');
  assert.strictEqual(extractText(null), '');
});

test('extractText falls back to content[0].text when no typed text block', () => {
  const resp = { content: [{ text: 'legacy-shape' }] };
  assert.strictEqual(extractText(resp), 'legacy-shape');
});

test('estimateCost matches claude-sonnet-5 (intro $2/$10 or std $3/$15)', () => {
  const cost = estimateCost('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  // Intro through Aug 31 2026 → 12; after → 18
  assert.ok(cost === 12 || cost === 18, `unexpected sonnet-5 cost ${cost}`);
});

test('estimateCost matches claude-haiku-4-5 at $1/$5 (not retired 3.5 rates)', () => {
  const cost = estimateCost('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.strictEqual(cost, 6);
});

test('estimateCost prefers longer haiku-4-5 prefix over haiku-4', () => {
  const h45 = estimateCost('claude-haiku-4-5-20251001', { inputTokens: 1_000_000, outputTokens: 0 });
  const h4 = estimateCost('claude-haiku-4-20250514', { inputTokens: 1_000_000, outputTokens: 0 });
  assert.strictEqual(h45, 1);
  assert.strictEqual(h4, 0.8);
});

test('estimateCost prices claude-opus-5-5 at $4/$20 with $0.20 cache reads', () => {
  assert.strictEqual(estimateCost('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 24);
  assert.strictEqual(estimateCost('claude-opus-5-5', { cacheReadTokens: 1_000_000 }), 0.2);
  assert.strictEqual(estimateCost('claude-opus-5-5', { cacheCreationTokens: 1_000_000 }), 5);
});

test('estimateCost keeps claude-opus-5 apart from claude-opus-5-5', () => {
  assert.strictEqual(estimateCost('claude-opus-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 30);
  assert.strictEqual(estimateCost('claude-opus-5', { cacheReadTokens: 1_000_000 }), 0.5);
});

test('estimateCost prices Opus 4.6 to 4.8 at $5/$25, older Opus 4 at $15/$75', () => {
  for (const m of ['claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8']) {
    assert.strictEqual(estimateCost(m, { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 30, m);
  }
  assert.strictEqual(estimateCost('claude-opus-4-1-20250805', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 90);
});

test('estimateCost prices claude-sonnet-5-5 and claude-haiku-5-5', () => {
  assert.strictEqual(estimateCost('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 12);
  assert.strictEqual(estimateCost('claude-sonnet-5-5', { cacheReadTokens: 1_000_000 }), 0.1);
  assert.strictEqual(estimateCost('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 1_000_000 }), 0.51);
});

test('estimateCost prices Fable and Mythos 5.x', () => {
  assert.strictEqual(estimateCost('claude-fable-5-2', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 48);
  assert.strictEqual(estimateCost('claude-fable-5-2', { cacheReadTokens: 1_000_000 }), 0.2);
  assert.strictEqual(estimateCost('claude-fable-5-1', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 60);
  assert.strictEqual(estimateCost('claude-mythos-5-2', { inputTokens: 1_000_000, outputTokens: 1_000_000 }), 48);
});

test('hasPrice is false for models that fall back to the default rate', () => {
  assert.strictEqual(hasPrice('claude-opus-5-5'), true);
  assert.strictEqual(hasPrice('gpt-unknown'), false);
  assert.strictEqual(hasPrice(''), false);
});

test('estimateCost prices Haiku 5.5 prompts over 100K tokens at $0.50/$2.50', () => {
  assert.strictEqual(estimateCost('claude-haiku-5-5', { inputTokens: 100_000, outputTokens: 0 }), 0.01);
  assert.strictEqual(estimateCost('claude-haiku-5-5', { inputTokens: 200_000, outputTokens: 1_000_000 }), 2.6);
});

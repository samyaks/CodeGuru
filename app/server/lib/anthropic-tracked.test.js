const { test } = require('node:test');
const assert = require('node:assert');

const { extractText, estimateCost } = require('./anthropic-tracked');

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

test('estimateCost matches claude-sonnet-5 at $2/$10', () => {
  const cost = estimateCost('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 });
  assert.strictEqual(cost, 12);
});

test('estimateCost prices opus-5-5 at $4/$20, not the older opus-5 / opus-4 buckets', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };
  assert.strictEqual(estimateCost('claude-opus-5-5', usage), 24);
  assert.strictEqual(estimateCost('claude-opus-5', usage), 30);
  assert.strictEqual(estimateCost('claude-opus-4-0', usage), 90);
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

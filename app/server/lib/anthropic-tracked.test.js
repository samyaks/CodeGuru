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

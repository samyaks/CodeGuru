const { test } = require('node:test');
const assert = require('node:assert');

const { extractText } = require('./anthropic-tracked');

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

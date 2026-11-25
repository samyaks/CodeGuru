'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { renderBlock, applyBlock, MARKER_START, MARKER_END } = require('../lib');

const data = YAML.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v2.yaml'), 'utf8'));
const block = renderBlock(data);

test('the block carries product, areas, rules, nevers and agreements', () => {
  assert.ok(block.startsWith(MARKER_START) && block.endsWith(MARKER_END));
  for (const needle of ['Delta-V', 'Billing & pricing (`billing`)', '`src/billing/**`', 'Stripe holds all billing data', 'Never store card numbers.', 'annual plan at 20% off monthly', 'samyak@example.com']) {
    assert.ok(block.includes(needle), `missing: ${needle}`);
  }
});

test('rendering is deterministic and ignores key order', () => {
  assert.strictEqual(renderBlock(data), renderBlock(JSON.parse(JSON.stringify(data))));
});

test('a new file is just the block (plus any prefix)', () => {
  assert.strictEqual(applyBlock(null, block).text, `${block}\n`);
  assert.strictEqual(applyBlock(null, block, { prefix: '---\nx: 1\n---\n\n' }).text, `---\nx: 1\n---\n\n${block}\n`);
});

test('existing content without markers is kept and the block is appended', () => {
  const r = applyBlock('# Mine\n\nHand-written.\n', block);
  assert.ok(r.text.startsWith('# Mine\n\nHand-written.\n\n'));
  assert.ok(r.text.endsWith(`${block}\n`));
  assert.ok(applyBlock('no newline', block).text.startsWith('no newline\n\n'));
});

test('content outside the markers is never touched, and re-applying is a no-op', () => {
  const before = `top\n\n${MARKER_START}\nold stuff\n${MARKER_END}\n\nbottom\n`;
  const once = applyBlock(before, block).text;
  assert.ok(once.startsWith('top\n\n') && once.endsWith('\n\nbottom\n'));
  assert.ok(!once.includes('old stuff'));
  assert.strictEqual(applyBlock(once, block).text, once);
});

test('CRLF files stay CRLF', () => {
  const r = applyBlock(`a\r\n${MARKER_START}\r\nx\r\n${MARKER_END}\r\nz\r\n`, block).text;
  assert.ok(!/[^\r]\n/.test(r), 'every newline is CRLF');
  assert.strictEqual(applyBlock(r, block).text, r);
});

test('broken markers are an error and leave the text alone', () => {
  for (const bad of [`${MARKER_START}\nno end`, `${MARKER_END}\n${MARKER_START}`, `${MARKER_START}\n${MARKER_END}\n${MARKER_START}\n${MARKER_END}`]) {
    const r = applyBlock(bad, block);
    assert.ok(r.error, bad);
    assert.strictEqual(r.text, bad);
  }
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { validateText } = require('../lib');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const errorsOf = (r) => r.issues.filter((i) => i.severity === 'error');
const only = (r, pathStr) => r.issues.filter((i) => i.path === pathStr);

test('the example from the plan is valid v2 with no issues', () => {
  const r = validateText(fixture('v2.yaml'));
  assert.deepStrictEqual(r.issues, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.version, 2);
});

test('a v1 file parses and only gets a warning pointing at migrate', () => {
  const r = validateText(fixture('v1.yaml'));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.version, 1);
  assert.match(r.issues[0].message, /takeoff migrate/);
});

test('YAML syntax errors come back as issues with a line number', () => {
  const r = validateText('version: 2\nproduct: [unclosed\n');
  assert.strictEqual(r.ok, false);
  assert.ok(errorsOf(r)[0].line >= 1);
  assert.match(errorsOf(r)[0].message, /YAML syntax/);
});

test('unsupported version and non-mapping documents are errors', () => {
  assert.match(errorsOf(validateText('version: 3\n'))[0].message, /Unsupported version 3/);
  assert.strictEqual(validateText('- a\n- b\n').ok, false);
  assert.strictEqual(validateText('').ok, false);
});

test('missing product name, bad area shapes and duplicates are reported with paths and lines', () => {
  const r = validateText([
    'version: 2',
    'product: {}',
    'areas:',
    '  - id: Billing',
    '    name: Billing',
    '    paths: []',
    '  - id: web',
    '    name: Web',
    '    paths: ["/src/**"]',
    '    creators: ["not-an-email"]',
    '  - id: web',
    '    name: Web again',
    '    paths: ["x"]',
    '',
  ].join('\n'));
  assert.strictEqual(r.ok, false);
  assert.ok(only(r, 'product.name').length);
  assert.ok(only(r, 'areas[0].id').length, 'uppercase id');
  assert.ok(only(r, 'areas[0].paths').length, 'empty paths');
  assert.ok(only(r, 'areas[1].paths[0]').some((i) => i.severity === 'warning'), 'leading slash warns');
  assert.ok(only(r, 'areas[1].creators[0]').length, 'bad email');
  const dup = only(r, 'areas[2].id')[0];
  assert.match(dup.message, /Duplicate area id/);
  assert.strictEqual(dup.line, 11);
});

test('agreements: id, area reference, date, emails, source', () => {
  const r = validateText([
    'version: 2',
    'product: { name: X, summary: y }',
    'areas: [ { id: billing, name: B, paths: [a] } ]',
    'agreements:',
    '  - id: nope',
    '    area: missing',
    '    text: ""',
    '    agreed_by: []',
    '    agreed_on: 2026-02-31',
    '    source: ftp://x',
    '',
  ].join('\n'));
  for (const p of ['agreements[0].id', 'agreements[0].area', 'agreements[0].text', 'agreements[0].agreed_by', 'agreements[0].agreed_on', 'agreements[0].source']) {
    assert.ok(only(r, p).some((i) => i.severity === 'error'), `error at ${p}`);
  }
});

test('duplicate agreement ids and duplicate YAML keys are errors', () => {
  const dupAgr = validateText(fixture('v2.yaml') + [
    '  - id: agr_2026_11_24_annual_plan',
    '    text: again',
    '    agreed_by: [a@b.co]',
    '    agreed_on: 2026-11-25',
    '',
  ].join('\n'));
  assert.ok(only(dupAgr, 'agreements[1].id').some((i) => /Duplicate agreement id/.test(i.message)));
  assert.strictEqual(validateText('version: 2\nversion: 2\n').ok, false);
});

test('unknown keys are warnings, not errors; rules may be objects with ids', () => {
  const r = validateText([
    'version: 2',
    'product: { name: X, summary: y, colour: red }',
    'areas:',
    '  - id: a',
    '    name: A',
    '    paths: [x]',
    '    rules:',
    '      - { id: r1, text: "One." }',
    '      - { id: r1, text: "Two." }',
    '      - { text: "" }',
    '',
  ].join('\n'));
  assert.ok(only(r, 'product.colour').every((i) => i.severity === 'warning'));
  assert.ok(only(r, 'areas[0].rules[1].id').some((i) => /Duplicate rule id/.test(i.message)));
  assert.ok(only(r, 'areas[0].rules[2].text').length);
});

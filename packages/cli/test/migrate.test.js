'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { migrateData, stringifyV2, validateText } = require('../lib');

const v1 = YAML.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'v1.yaml'), 'utf8'));

test('migrating the v1 fixture gives a valid v2 file', () => {
  const { data, notes } = migrateData(v1);
  const text = stringifyV2(data);
  const r = validateText(text);
  assert.strictEqual(r.ok, true, JSON.stringify(r.issues));
  assert.strictEqual(r.version, 2);
  assert.deepStrictEqual(r.issues.filter((i) => i.severity === 'error'), []);
  assert.strictEqual(data.product.name, 'Delta-V');
  assert.strictEqual(data.product.summary, 'Plans trips for two.');
  assert.deepStrictEqual(data.areas.map((a) => a.id), ['billing-pricing', 'general']);
  assert.deepStrictEqual(data.areas[0].paths, ['src/billing/**']);
  assert.deepStrictEqual(data.areas[1].paths, ['**']);
  assert.deepStrictEqual(data.areas[1].never, ['Never log tokens.']);
  assert.ok(notes.some((n) => /Unknown key `colour`/.test(n)), 'dropped keys are reported');
});

test('migrate handles product as a string or mapping, duplicate names, and an empty file', () => {
  const a = migrateData({ product: 'P', areas: [{ name: 'Web', paths: ['a'] }, { name: 'Web', paths: ['b'] }] });
  assert.deepStrictEqual(a.data.areas.map((x) => x.id), ['web', 'web-2']);
  const b = migrateData({ product: { name: 'P', summary: 'S' } });
  assert.deepStrictEqual(b.data.product, { name: 'P', summary: 'S' });
  const c = migrateData(null);
  assert.strictEqual(c.data.product.name, 'My product');
  assert.ok(c.notes.length >= 2);
  assert.strictEqual(validateText(stringifyV2(c.data)).ok, true);
});

test('areas without paths are carried over with a note, and still validate as errors until fixed', () => {
  const { data, notes } = migrateData({ name: 'P', areas: [{ name: 'Web' }] });
  assert.ok(notes.some((n) => /no paths/.test(n)));
  assert.strictEqual(validateText(stringifyV2(data)).ok, false);
});

test('migrating a v2 object’s output twice changes nothing', () => {
  const once = stringifyV2(migrateData(v1).data);
  const twice = stringifyV2(require('yaml').parse(once));
  assert.strictEqual(twice, once);
});

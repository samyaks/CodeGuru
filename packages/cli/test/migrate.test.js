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

test('v1 shapes that v2 is stricter about still migrate to a valid file, with notes', () => {
  const { data, notes } = migrateData({
    name: 'P',
    areas: [
      { name: 'Web' },
      { name: 'Docs', path: 'docs/**', creator: 'Samyak', creators: undefined },
      { name: 'API', paths: ['api/**', 7], creators: ['a@b.co', 'not-an-email'], rules: [{ id: 'R1', text: 'keep fast' }, { id: 'ok', text: 'one' }, { id: 'ok', text: 'two' }, 42], screens: [{ name: 'Home', route: '/' }, { name: 'Bad' }], owner: 'x' },
    ],
    rules: null,
  });
  const r = validateText(stringifyV2(data));
  assert.strictEqual(r.ok, true, JSON.stringify(r.issues));
  assert.deepStrictEqual(data.areas[0].paths, ['**']);
  assert.strictEqual(data.areas[1].creators, undefined);
  assert.deepStrictEqual(data.areas[2].paths, ['api/**']);
  assert.deepStrictEqual(data.areas[2].creators, ['a@b.co']);
  assert.deepStrictEqual(data.areas[2].rules, ['keep fast', { id: 'ok', text: 'one' }, 'two']);
  assert.deepStrictEqual(data.areas[2].screens, [{ name: 'Home', route: '/' }]);
  for (const re of [/had no paths/, /dropped "Samyak"/, /dropped "not-an-email"/, /"R1"/, /not a rule/, /dropped a screen/, /unknown key `owner`/, /not text/]) {
    assert.ok(notes.some((n) => re.test(n)), `note matching ${re}: ${notes.join(' | ')}`);
  }
});

test('migrate output is stable: re-reading and re-writing it changes nothing', () => {
  const once = stringifyV2(migrateData(v1).data);
  const reread = validateText(once);
  assert.strictEqual(reread.ok, true);
  assert.strictEqual(stringifyV2(reread.data), once);
});

const { test } = require('node:test');
const assert = require('node:assert');

const {
  normalizeAreaName,
  dedupeAreas,
  collectSeedNames,
  parseVocabulary,
  parseAssignments,
  vocabularyIndex,
  chunk,
} = require('./grouping');

test('normalizeAreaName trims, collapses whitespace, caps length', () => {
  assert.strictEqual(normalizeAreaName('  Repo   analysis '), 'Repo analysis');
  assert.strictEqual(normalizeAreaName(null), '');
  assert.strictEqual(normalizeAreaName(''), '');
  assert.strictEqual(normalizeAreaName('x'.repeat(80)).length, 60);
});

test('dedupeAreas dedupes case-insensitively, keeps first casing, caps', () => {
  const out = dedupeAreas(['Authentication', 'authentication', 'Repo Analysis', '', null]);
  assert.deepStrictEqual(out, ['Authentication', 'Repo Analysis']);

  const capped = dedupeAreas(['a', 'b', 'c', 'd'], 2);
  assert.deepStrictEqual(capped, ['a', 'b']);
});

test('collectSeedNames pulls feature names, ignores missing/blank', () => {
  const seeds = collectSeedNames({
    features: [
      { name: 'auth', fileCount: 3 },
      { name: 'auth' },
      { name: '' },
      { notName: 'x' },
      { name: 'analysis' },
    ],
  });
  assert.deepStrictEqual(seeds, ['auth', 'analysis']);
  assert.deepStrictEqual(collectSeedNames({}), []);
  assert.deepStrictEqual(collectSeedNames(null), []);
});

test('parseVocabulary accepts array, object.areas, and fences; rejects junk', () => {
  assert.deepStrictEqual(parseVocabulary('["Auth","Billing"]'), ['Auth', 'Billing']);
  assert.deepStrictEqual(
    parseVocabulary('```json\n["Auth", "Auth", "Billing"]\n```'),
    ['Auth', 'Billing'],
  );
  assert.deepStrictEqual(parseVocabulary('{"areas":["A","B"]}'), ['A', 'B']);
  assert.deepStrictEqual(parseVocabulary('not json'), []);
  assert.deepStrictEqual(parseVocabulary(''), []);
});

test('parseAssignments maps 1-based index -> id, canonicalizes area, drops invalid', () => {
  const batch = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const idx = vocabularyIndex(['Authentication', 'Repo Analysis']);

  const out = parseAssignments(
    '{"1":"authentication","2":"Repo Analysis","3":"Nonexistent"}',
    batch,
    idx,
  );
  // index 1 -> canonical casing, index 2 -> exact, index 3 -> dropped (not in vocab)
  assert.deepStrictEqual(out, [
    { id: 'a', groupLabel: 'Authentication' },
    { id: 'b', groupLabel: 'Repo Analysis' },
  ]);
});

test('parseAssignments ignores out-of-range / non-numeric keys and bad json', () => {
  const batch = [{ id: 'a' }];
  const idx = vocabularyIndex(['Auth']);
  assert.deepStrictEqual(parseAssignments('{"5":"Auth","x":"Auth"}', batch, idx), []);
  assert.deepStrictEqual(parseAssignments('garbage', batch, idx), []);
  assert.deepStrictEqual(parseAssignments('[]', batch, idx), []);
});

test('chunk splits into bounded batches', () => {
  assert.deepStrictEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepStrictEqual(chunk([], 3), []);
});

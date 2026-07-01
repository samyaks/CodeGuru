const { test } = require('node:test');
const assert = require('node:assert');

const {
  parseFeatureCatalog,
  buildJobVocabulary,
  normalizePriority,
  shortText,
  cleanStr,
} = require('./features');

test('normalizePriority accepts known values and defaults to medium', () => {
  assert.strictEqual(normalizePriority('high'), 'high');
  assert.strictEqual(normalizePriority('HIGH'), 'high');
  assert.strictEqual(normalizePriority(' low '), 'low');
  assert.strictEqual(normalizePriority('bogus'), 'medium');
  assert.strictEqual(normalizePriority(null), 'medium');
});

test('shortText collapses whitespace and truncates long text', () => {
  assert.strictEqual(shortText('  a\n  b   c '), 'a b c');
  const long = 'x'.repeat(400);
  const out = shortText(long);
  assert.ok(out.length <= 241);
  assert.ok(out.endsWith('\u2026'));
});

test('cleanStr trims, collapses, and caps length', () => {
  assert.strictEqual(cleanStr('  hi   there '), 'hi there');
  assert.strictEqual(cleanStr('abcdef', 3), 'abc');
  assert.strictEqual(cleanStr(null), '');
});

test('parseFeatureCatalog parses a plain JSON array', () => {
  const raw = JSON.stringify([
    { title: 'Repo Analysis', summary: 'Analyze a repo', persona: 'Developer', personaEmoji: '\u{1F9D1}', job: 'Understand a codebase', priority: 'high' },
    { title: 'Auth', summary: 'Sign in', persona: 'Developer', job: 'Sign in securely', priority: 'weird' },
  ]);
  const out = parseFeatureCatalog(raw);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out[0], {
    title: 'Repo Analysis',
    summary: 'Analyze a repo',
    personaName: 'Developer',
    personaEmoji: '\u{1F9D1}',
    jobTitle: 'Understand a codebase',
    priority: 'high',
    jobId: null,
  });
  // invalid priority normalized to medium
  assert.strictEqual(out[1].priority, 'medium');
  assert.strictEqual(out[1].personaEmoji, null);
});

test('parseFeatureCatalog accepts an object with a features array and strips fences', () => {
  const raw = '```json\n' + JSON.stringify({ features: [{ title: 'X', summary: 's' }] }) + '\n```';
  const out = parseFeatureCatalog(raw);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].title, 'X');
});

test('parseFeatureCatalog dedupes by title (case-insensitive) and skips untitled', () => {
  const raw = JSON.stringify([
    { title: 'Repo Analysis' },
    { title: 'repo analysis' },
    { summary: 'no title' },
    { title: '   ' },
    { title: 'Auth' },
  ]);
  const out = parseFeatureCatalog(raw);
  assert.deepStrictEqual(out.map((f) => f.title), ['Repo Analysis', 'Auth']);
});

test('parseFeatureCatalog caps the number of features', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ title: `Feature ${i}` }));
  const out = parseFeatureCatalog(JSON.stringify(many), null, 5);
  assert.strictEqual(out.length, 5);
});

test('parseFeatureCatalog keeps jobId only when it matches a valid product-map job', () => {
  const raw = JSON.stringify([
    { title: 'A', jobId: 'job-1' },
    { title: 'B', jobId: 'job-does-not-exist' },
  ]);
  const valid = new Set(['job-1']);
  const out = parseFeatureCatalog(raw, valid);
  assert.strictEqual(out[0].jobId, 'job-1');
  assert.strictEqual(out[1].jobId, null);
});

test('parseFeatureCatalog returns [] on invalid JSON', () => {
  assert.deepStrictEqual(parseFeatureCatalog('not json'), []);
  assert.deepStrictEqual(parseFeatureCatalog(''), []);
});

test('buildJobVocabulary returns null when the map has no jobs', () => {
  assert.strictEqual(buildJobVocabulary(null), null);
  assert.strictEqual(buildJobVocabulary({ jobs: [] }), null);
});

test('buildJobVocabulary joins jobs to their personas and collects valid ids', () => {
  const map = {
    personas: [{ id: 'p1', name: 'Shop owner', emoji: '\u{1F6D2}' }],
    jobs: [
      { id: 'j1', title: 'Quote a price', priority: 'high', persona_id: 'p1' },
      { id: 'j2', title: 'Track orders', persona_id: 'missing' },
    ],
  };
  const vocab = buildJobVocabulary(map);
  assert.strictEqual(vocab.jobs.length, 2);
  assert.deepStrictEqual(vocab.jobs[0], {
    id: 'j1',
    title: 'Quote a price',
    priority: 'high',
    personaName: 'Shop owner',
    personaEmoji: '\u{1F6D2}',
  });
  // job with unknown persona still included, persona fields null, default priority
  assert.strictEqual(vocab.jobs[1].personaName, null);
  assert.strictEqual(vocab.jobs[1].priority, 'medium');
  assert.ok(vocab.validJobIds.has('j1'));
  assert.ok(vocab.validJobIds.has('j2'));
});

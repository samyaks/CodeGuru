const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAppWords } = require('./app-words');
const { buildLaunchChecks } = require('./launch-checks');

const map = {
  personas: [{ name: 'Dog Owners', emoji: '🐕' }, { name: 'Walker' }, { name: 'Admin' }],
  entities: [
    { type: 'table', key: 'users' },
    { type: 'table', key: 'sessions' },
    { type: 'table', key: 'bookings' },
    { type: 'table', key: 'walk_reviews' },
    { type: 'table', key: 'availability' },
    { type: 'page', key: 'checkout' },
  ],
};

test('people come out singular and lowercase, at most two', () => {
  assert.deepEqual(buildAppWords(map).people, ['dog owner', 'walker']);
});

test('things are the app’s own tables, plural, without plumbing tables', () => {
  assert.deepEqual(buildAppWords(map).things, ['bookings', 'walk reviews']);
});

test('no map gives empty lists', () => {
  assert.deepEqual(buildAppWords(null), { people: [], things: [] });
  assert.deepEqual(buildAppWords({}), { people: [], things: [] });
});

test('checks use the app’s nouns when there are some', () => {
  const r = buildLaunchChecks({ auth: { exists: false }, permissions: { exists: false }, database: { exists: false } }, buildAppWords(map));
  const by = (id) => r.checks.find((c) => c.id === id);
  assert.equal(by('signin').need, 'Dog owners and walkers can sign in and out.');
  assert.equal(by('permissions').need, 'Each dog owner only sees and changes their own bookings and walk reviews.');
  assert.match(by('permissions').explanation, /signed-in dog owner/);
  assert.equal(by('data').need, 'Bookings and walk reviews are saved and still there after a restart.');
  assert.match(by('data').explanation, /^Bookings and walk reviews aren’t saved/);
});

test('checks stay plain with no words', () => {
  const r = buildLaunchChecks({ auth: { exists: false }, database: { exists: false } });
  assert.equal(r.checks.find((c) => c.id === 'signin').need, 'People can sign in and out.');
  assert.equal(r.checks.find((c) => c.id === 'data').need, 'What people enter is saved and is still there after a restart.');
  assert.match(r.checks.find((c) => c.id === 'data').explanation, /^What people enter isn’t saved/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildLaunchChecks, NOT_CHECKED } = require('./launch-checks');

const byId = (r, id) => r.checks.find((c) => c.id === id);

test('no saved scan gives no checks, not a pile of grounded ones', () => {
  assert.deepEqual(buildLaunchChecks(undefined).checks, []);
  assert.deepEqual(buildLaunchChecks({}).checks, []);
});

test('a complete scan clears every check and lists what is not checked', () => {
  const r = buildLaunchChecks({
    auth: { exists: true, confidence: 0.9, issues: [] },
    permissions: { exists: true, confidence: 0.9, hasRoles: true },
    database: { exists: true, confidence: 0.9, hasSchema: true, hasMigrations: true },
    deployment: { exists: true, confidence: 0.9 },
    envConfig: { exists: true, confidence: 0.9, hasExample: true, missingVars: [] },
    errorHandling: { exists: true, confidence: 0.9, hasGlobalHandler: true },
    testing: { exists: true, confidence: 0.9, coverage: 'unknown' },
  });
  assert.equal(r.checks.length, 7);
  assert.ok(r.checks.every((c) => c.status === 'cleared'));
  assert.deepEqual(r.notChecked, NOT_CHECKED);
});

test('missing things are grounded, partial things are holding', () => {
  const r = buildLaunchChecks({
    auth: { exists: true, confidence: 0.9, issues: ['weak'] },
    permissions: { exists: false, confidence: 0 },
    envConfig: { exists: true, confidence: 0.9, hasExample: true, missingVars: ['A', 'B'] },
  });
  assert.equal(byId(r, 'signin').status, 'holding');
  assert.equal(byId(r, 'permissions').status, 'grounded');
  assert.equal(byId(r, 'secrets').status, 'holding');
  assert.match(byId(r, 'secrets').explanation, /2 settings are/);
  assert.equal(byId(r, 'tests').status, 'grounded');
});

test('explanations never mention code or file paths', () => {
  const r = buildLaunchChecks({ auth: { exists: false } });
  for (const c of r.checks) assert.doesNotMatch(c.explanation, /\.(js|ts)\b|\//);
});

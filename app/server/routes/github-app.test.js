const { test } = require('node:test');
const assert = require('node:assert');

const { _internal: { safeReturnTo, withStatus } } = require('./github-app');

test('safeReturnTo only allows same-origin relative paths', () => {
  assert.strictEqual(safeReturnTo('/dashboard'), '/dashboard');
  assert.strictEqual(safeReturnTo('/?repo=acme/x'), '/?repo=acme/x');
  for (const bad of ['https://evil.test', '//evil.test/x', '/\\evil.test', 'dashboard', '', null, undefined, 42]) {
    assert.strictEqual(safeReturnTo(bad), '/dashboard', `should reject ${String(bad)}`);
  }
});

test('withStatus appends github_app to the query, keeping any hash', () => {
  assert.strictEqual(withStatus('/dashboard', 'connected'), '/dashboard?github_app=connected');
  assert.strictEqual(withStatus('/?x=1', 'error'), '/?x=1&github_app=error');
  assert.strictEqual(withStatus('/read/1#gaps', 'connected'), '/read/1?github_app=connected#gaps');
});

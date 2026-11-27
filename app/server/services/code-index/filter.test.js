'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { classifyPath, prepareText, redactSecrets, isSafePath, MAX_FILE_BYTES, REDACTED } = require('./filter');

const AWS = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const ANTHROPIC = 'sk-ant-' + 'api03-abcdefghijklmnopqrstuvwxyz0123';

test('a planted AWS key is replaced before anything is stored', () => {
  const r = prepareText('src/config.js', `const key = "${AWS}";\nconst other = '${ANTHROPIC}';\n`);
  assert.strictEqual(r.skippedReason, null);
  assert.ok(!r.content.includes(AWS));
  assert.ok(!r.content.includes(ANTHROPIC));
  assert.strictEqual(r.redactions, 2);
  assert.ok(r.content.includes(REDACTED));
});

test('.env files and keys keep their path but never their text', () => {
  for (const p of ['.env', 'app/.env.production', 'config/prod.env', 'deploy/server.pem', 'id_rsa', 'secrets.yaml',
    'gcp/service-account-prod.json', '.npmrc', 'infra/terraform.tfstate', 'credentials']) {
    const cls = classifyPath(p);
    assert.deepStrictEqual(cls, { index: true, neverReadable: true }, p);
    const r = prepareText(p, `TOKEN=${AWS}\nPLAIN=hello`, { neverReadable: cls.neverReadable });
    assert.strictEqual(r.content, null, p);
    assert.strictEqual(r.skippedReason, 'never_readable', p);
  }
  // Even without the flag, a never-readable name is never read.
  assert.strictEqual(prepareText('.env.local', 'A=1').content, null);
});

test('a private key block anywhere means no text', () => {
  const r = prepareText('src/fixture.txt', 'x\n-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n');
  assert.strictEqual(r.content, null);
  assert.strictEqual(r.skippedReason, 'private_key');
});

test('vendored folders, build output and lockfiles are left out', () => {
  for (const p of ['node_modules/x/index.js', 'web/dist/app.js', 'vendor/lib.go', '.git/config', 'a/build/x.js', 'package-lock.json', 'api/yarn.lock', 'go.sum']) {
    assert.strictEqual(classifyPath(p).index, false, p);
  }
  assert.deepStrictEqual(classifyPath('src/build.js'), { index: true });
  assert.deepStrictEqual(classifyPath('README.md'), { index: true });
});

test('unsafe paths are refused', () => {
  for (const p of ['../x', 'a/../b', '/etc/passwd', 'a//b', 'a\\b', './a', `a\u0000b`, '']) {
    assert.strictEqual(isSafePath(p), false, JSON.stringify(p));
    assert.strictEqual(classifyPath(p).index, false);
  }
});

test('big, binary and minified files keep no text', () => {
  assert.strictEqual(prepareText('a.js', Buffer.alloc(MAX_FILE_BYTES + 1, 97)).skippedReason, 'too_large');
  assert.strictEqual(prepareText('a.js', 'small', { size: MAX_FILE_BYTES + 5 }).skippedReason, 'too_large');
  assert.strictEqual(prepareText('logo.png', 'not really a png').skippedReason, 'binary');
  assert.strictEqual(prepareText('data.txt', Buffer.from([65, 0, 66])).skippedReason, 'binary');
  assert.strictEqual(prepareText('vendor.min.js', 'var a=1').skippedReason, 'minified');
  assert.strictEqual(prepareText('bundle.js', 'x'.repeat(20000)).skippedReason, 'minified');
});

test('ordinary code is kept as written, with its language', () => {
  const r = prepareText('src/server.ts', 'export function start() {}\n');
  assert.strictEqual(r.content, 'export function start() {}\n');
  assert.strictEqual(r.redactions, 0);
  assert.strictEqual(r.language, 'typescript');
});

test('redactSecrets counts every match', () => {
  const { text, count } = redactSecrets(`${AWS} and ${AWS}`);
  assert.strictEqual(count, 2);
  assert.strictEqual(text, `${REDACTED} and ${REDACTED}`);
});

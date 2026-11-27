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

test('more secret shapes are redacted (review findings)', () => {
  const samples = {
    'src/a.js': [
      `const k = "sk-proj-${'Ab1_-'.repeat(10)}";`,
      `const t = "ghs_${'a1'.repeat(20)}";`,
      `const u = 'ghu_${'b2'.repeat(20)}';`,
      `const j = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";`,
      `const hook = "https://hooks.slack.com/services/T000/B000/${'x'.repeat(24)}";`,
      `const db = "rediss://default:${'p'.repeat(12)}@cache.example.com:6380";`,
      `define('DB_PASSWORD', 'hunter2hunter2');`,
      `aws_secret_access_key = "${'A'.repeat(20)}/${'b'.repeat(19)}"`,
      `const s = "whsec_${'c'.repeat(32)}";`,
    ],
    'config/app.yml': [`  password: correcthorsebattery`, `POSTGRES_PASSWORD=supersecretvalue`],
    'src/main/resources/application.properties': ['spring.datasource.password=letmein-please-123'],
  };
  for (const [p, lines] of Object.entries(samples)) {
    for (const line of lines) {
      const r = prepareText(p, `${line}\n`);
      assert.ok(r.redactions >= 1, `${p}: ${line}`);
      assert.ok(r.content.includes(REDACTED), `${p}: ${line}`);
    }
  }
});

test('ordinary code that only names a secret is left alone', () => {
  const code = 'const token = req.headers.authorization;\nconst password = form.get("password");\nif (!apiKey) throw new Error("missing");\n';
  const r = prepareText('src/auth.js', code);
  assert.strictEqual(r.redactions, 0);
  assert.strictEqual(r.content, code);
});

test('more never-readable files, PGP keys and Kubernetes secrets keep no text', () => {
  for (const p of ['.envrc', '.env-local', 'env.production', 'infra/terraform.tfstate.backup', 'kubeconfig', 'prod.kubeconfig',
    'home/.docker/config.json', 'credentials.tfrc.json', '.yarnrc.yml', '.s3cfg', '.aws/credentials']) {
    assert.strictEqual(prepareText(p, 'anything').skippedReason, 'never_readable', p);
  }
  assert.strictEqual(prepareText('keys/pub.txt', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nx\n').skippedReason, 'private_key');
  assert.strictEqual(prepareText('k8s/secret.yaml', 'apiVersion: v1\nkind: Secret\ndata:\n  token: c2VjcmV0\n').skippedReason, 'never_readable');
  assert.strictEqual(prepareText('k8s/deploy.yaml', 'apiVersion: apps/v1\nkind: Deployment\n').skippedReason, null);
});

test('hostile input stays fast (no regex backtracking)', () => {
  const lines = (s, n) => (s + '\n').repeat(n);
  for (const [p, text] of [
    ['a.js', ' \n'.repeat(250000)],
    ['a.py', ' \n'.repeat(250000)],
    ['b.js', lines("require('".repeat(100), 500)],
    ['c.txt', lines('postgres://' + 'a:'.repeat(2400), 90)],
    ['d.yml', lines('password'.repeat(600), 100)],
  ]) {
    const t0 = Date.now();
    prepareText(p, text);
    require('./extract').extractSpecs(p, text);
    assert.ok(Date.now() - t0 < 2000, `${p} took ${Date.now() - t0} ms`);
  }
});

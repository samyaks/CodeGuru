const { test } = require('node:test');
const assert = require('node:assert');

const { extractStructureAnchors, deriveFeatureArea } = require('./structure-extractor');

// Tiny in-memory repo exercising every anchor kind and feature-area path.
const fileContents = {
  'src/api/auth/login.js': [
    "const express = require('express');",
    'const router = express.Router();',
    '',
    'async function loginHandler(req, res) {',
    '  res.json({ ok: true });',
    '}',
    '',
    "router.post('/login', loginHandler);",
    '',
    'module.exports = { router, loginHandler };',
    '',
  ].join('\n'),

  'prisma/schema.prisma': [
    'model User {',
    '  id    Int    @id @default(autoincrement())',
    '  email String @unique',
    '}',
    '',
  ].join('\n'),

  'server.js': [
    "const express = require('express');",
    'const app = express();',
    "app.get('/health', (req, res) => res.send('ok'));",
    'app.listen(3000);',
    'module.exports = app;',
    '',
  ].join('\n'),

  'app/api/orders/route.ts': [
    'export async function GET(req: Request) {',
    '  return Response.json([]);',
    '}',
    'export async function POST(req: Request) {',
    '  return Response.json({});',
    '}',
    '',
  ].join('\n'),

  // Should be skipped entirely.
  'node_modules/lib/index.js': 'export function nope() {}',
  'src/api/auth/login.test.js': "test('x', () => {});",
};

function findAnchor(anchors, kind, symbol) {
  return anchors.find((a) => a.kind === kind && a.symbol === symbol);
}

test('extracts a route with correct feature_area', () => {
  const anchors = extractStructureAnchors(fileContents, Object.keys(fileContents));
  const route = findAnchor(anchors, 'route', 'POST /login');
  assert.ok(route, 'expected a POST /login route anchor');
  assert.strictEqual(route.file_path, 'src/api/auth/login.js');
  assert.strictEqual(route.feature_area, 'auth');
});

test('extracts an exported function (not the router const)', () => {
  const anchors = extractStructureAnchors(fileContents, Object.keys(fileContents));
  const fn = findAnchor(anchors, 'function', 'loginHandler');
  assert.ok(fn, 'expected a loginHandler function anchor');
  assert.strictEqual(fn.file_path, 'src/api/auth/login.js');
  assert.strictEqual(fn.feature_area, 'auth');
  // `router` is a call-expression const, not a function — must not be an anchor.
  assert.strictEqual(findAnchor(anchors, 'function', 'router'), undefined);
});

test('extracts a prisma model', () => {
  const anchors = extractStructureAnchors(fileContents, Object.keys(fileContents));
  const model = findAnchor(anchors, 'model', 'User');
  assert.ok(model, 'expected a User model anchor');
  assert.strictEqual(model.file_path, 'prisma/schema.prisma');
  assert.strictEqual(model.feature_area, 'prisma');
});

test('extracts the entrypoint and its route', () => {
  const anchors = extractStructureAnchors(fileContents, Object.keys(fileContents));
  const entry = findAnchor(anchors, 'entrypoint', 'server.js');
  assert.ok(entry, 'expected a server.js entrypoint anchor');
  assert.strictEqual(entry.feature_area, 'core');

  const health = findAnchor(anchors, 'route', 'GET /health');
  assert.ok(health, 'expected a GET /health route anchor');
  assert.strictEqual(health.file_path, 'server.js');
});

test('extracts HTTP handler endpoints with checkout feature_area', () => {
  const anchors = extractStructureAnchors(fileContents, Object.keys(fileContents));
  const get = findAnchor(anchors, 'endpoint', 'GET /api/orders');
  const post = findAnchor(anchors, 'endpoint', 'POST /api/orders');
  assert.ok(get, 'expected a GET /api/orders endpoint anchor');
  assert.ok(post, 'expected a POST /api/orders endpoint anchor');
  assert.strictEqual(get.feature_area, 'checkout');
  // HTTP-method handlers must not also show up as generic functions.
  assert.strictEqual(findAnchor(anchors, 'function', 'GET'), undefined);
});

test('skips node_modules and test files', () => {
  const anchors = extractStructureAnchors(fileContents, Object.keys(fileContents));
  assert.ok(!anchors.some((a) => a.file_path.startsWith('node_modules/')));
  assert.ok(!anchors.some((a) => a.file_path.endsWith('.test.js')));
});

test('is pure and deterministic', () => {
  const keys = Object.keys(fileContents);
  const a = extractStructureAnchors(fileContents, keys);
  const b = extractStructureAnchors(fileContents, keys);
  assert.deepStrictEqual(a, b);
});

test('deriveFeatureArea rules and fallback', () => {
  assert.strictEqual(deriveFeatureArea('src/api/auth/login.js', null), 'auth');
  assert.strictEqual(deriveFeatureArea('server/routes/checkout.js', '/api/orders'), 'checkout');
  assert.strictEqual(deriveFeatureArea('src/billing/invoice.js', null), 'checkout');
  assert.strictEqual(deriveFeatureArea('src/dashboard/widgets.ts', null), 'dashboard');
  assert.strictEqual(deriveFeatureArea('server.js', null), 'core');
});

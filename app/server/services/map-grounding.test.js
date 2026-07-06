const { test } = require('node:test');
const assert = require('node:assert');

const { summarizeCodeContext } = require('./map-extractor');
const { heuristicLink, nameTokens } = require('./map-linker');

test('summarizeCodeContext returns empty string with no entities', () => {
  assert.strictEqual(summarizeCodeContext([]), '');
  assert.strictEqual(summarizeCodeContext(null), '');
});

test('summarizeCodeContext groups by type and annotates capability status', () => {
  const out = summarizeCodeContext([
    { type: 'page', key: '/dashboard', label: 'Dashboard' },
    { type: 'route', key: 'POST /api/orders', label: 'POST /api/orders' },
    { type: 'capability', key: 'cap:auth', status: 'present' },
    { type: 'capability', key: 'cap:payments', status: 'missing' },
    { type: 'component', key: 'OrderList' },
  ]);
  assert.match(out, /Pages: Dashboard/);
  assert.match(out, /Routes: POST \/api\/orders/);
  assert.match(out, /Capabilities detected: auth \(present\), payments \(missing\)/);
  assert.match(out, /Components: OrderList/);
});

test('summarizeCodeContext dedupes and caps each type', () => {
  const pages = Array.from({ length: 40 }, (_, i) => ({ type: 'page', key: `/p${i}`, label: `P${i}` }));
  const out = summarizeCodeContext(pages, { perTypeCap: 5 });
  const listed = out.replace('Pages: ', '').split(', ');
  assert.strictEqual(listed.length, 5);
});

test('nameTokens splits on separators and drops short tokens', () => {
  assert.deepStrictEqual(nameTokens('POST /api/orders/create'), ['post', 'orders', 'create']);
  assert.deepStrictEqual(nameTokens('Order_List-View'), ['order', 'list', 'view']);
});

test('heuristicLink matches jobs to capabilities via keywords', () => {
  const jobs = [{ id: 'j1', title: 'Let users log in securely' }];
  const entities = [{ id: 'cap:auth', type: 'capability', key: 'cap:auth', label: 'Auth' }];
  const edges = heuristicLink(jobs, entities);
  assert.ok(edges.some((e) => e.fromId === 'j1' && e.toId === 'cap:auth' && e.type === 'needs'));
});

test('heuristicLink now matches routes and components by token overlap (not just pages)', () => {
  const jobs = [{ id: 'j1', title: 'Create an order' }];
  const entities = [
    { id: 'r1', type: 'route', key: 'POST /api/orders' },
    { id: 'c1', type: 'component', key: 'OrderForm' },
    { id: 'p1', type: 'page', key: '/orders' },
    { id: 'x1', type: 'route', key: 'GET /api/settings' },
  ];
  const edges = heuristicLink(jobs, entities);
  const targets = new Set(edges.map((e) => e.toId));
  assert.ok(targets.has('r1'), 'matches order route');
  assert.ok(targets.has('c1'), 'matches OrderForm component');
  assert.ok(targets.has('p1'), 'matches /orders page');
  assert.ok(!targets.has('x1'), 'does not match unrelated settings route');
});

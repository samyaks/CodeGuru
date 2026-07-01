const { test } = require('node:test');
const assert = require('node:assert');

const { reconcileLinks } = require('./reconcile-links');

function anchor(file_path, symbol) {
  return { file_path, symbol, kind: 'function', feature_area: 'orders' };
}

function statement(links) {
  return { id: 's1', text: 'Users can place an order', feature_area: 'orders', links };
}

test('healthy no-op: file + symbol unchanged (symbol and file-level)', () => {
  const anchors = [anchor('src/orders/service.js', 'placeOrder')];
  const statements = [
    statement([
      { file_path: 'src/orders/service.js', symbol: 'placeOrder', link_status: 'healthy' },
      { file_path: 'src/orders/service.js', symbol: null, link_status: 'healthy' },
    ]),
  ];

  const { statements: out, triage } = reconcileLinks({ anchors, statements });

  assert.equal(triage.length, 0);
  const [symLink, fileLink] = out[0].links;
  assert.equal(symLink.link_status, 'healthy');
  assert.equal(symLink.file_path, 'src/orders/service.js');
  assert.equal(symLink.suggested_symbol, undefined);
  assert.equal(fileLink.link_status, 'healthy');
  assert.equal(fileLink.symbol, null);
});

test('clean file move: same symbol at a new path is auto-updated and healthy', () => {
  const anchors = [anchor('src/orders/place-order.js', 'placeOrder')];
  const statements = [
    statement([
      { file_path: 'src/orders/service.js', symbol: 'placeOrder', link_status: 'healthy' },
    ]),
  ];

  const { statements: out, triage } = reconcileLinks({ anchors, statements });

  assert.equal(triage.length, 0);
  const link = out[0].links[0];
  assert.equal(link.link_status, 'healthy');
  assert.equal(link.file_path, 'src/orders/place-order.js');
  assert.equal(link.suggested_symbol, undefined);
});

test('symbol rename within a file: needs_relink with suggested_symbol + triage', () => {
  const anchors = [
    anchor('src/orders/service.js', 'placeOrderV2'),
    anchor('src/orders/service.js', 'cancelOrder'),
  ];
  const statements = [
    statement([
      { file_path: 'src/orders/service.js', symbol: 'placeOrder', link_status: 'healthy' },
    ]),
  ];

  const { statements: out, triage } = reconcileLinks({ anchors, statements });

  const link = out[0].links[0];
  assert.equal(link.link_status, 'needs_relink');
  assert.equal(link.file_path, 'src/orders/service.js');
  assert.equal(link.suggested_symbol, 'placeOrderV2');

  assert.equal(triage.length, 1);
  assert.equal(triage[0].statementId, 's1');
  assert.equal(triage[0].statementText, 'Users can place an order');
  assert.equal(triage[0].featureArea, 'orders');
  assert.equal(triage[0].link.suggested_symbol, 'placeOrderV2');
});

test('true deletion: file + symbol gone with no successor -> broken + triage', () => {
  const anchors = [anchor('src/billing/invoice.js', 'generateInvoice')];
  const statements = [
    statement([
      { file_path: 'src/orders/service.js', symbol: 'placeOrder', link_status: 'healthy' },
    ]),
  ];

  const { statements: out, triage } = reconcileLinks({ anchors, statements });

  const link = out[0].links[0];
  assert.equal(link.link_status, 'broken');
  assert.equal(link.file_path, 'src/orders/service.js');
  assert.equal(link.suggested_symbol, null);

  assert.equal(triage.length, 1);
  assert.equal(triage[0].link.link_status, 'broken');
  assert.equal(triage[0].statementId, 's1');
});

test('file-level link whose file disappeared -> broken + triage', () => {
  const anchors = [anchor('src/billing/invoice.js', 'generateInvoice')];
  const statements = [
    statement([
      { file_path: 'src/orders/service.js', symbol: null, link_status: 'healthy' },
    ]),
  ];

  const { statements: out, triage } = reconcileLinks({ anchors, statements });

  assert.equal(out[0].links[0].link_status, 'broken');
  assert.equal(triage.length, 1);
});

test('ambiguous relocation: same symbol now in multiple files -> needs_relink, not auto-applied', () => {
  const anchors = [
    anchor('src/a/util.js', 'format'),
    anchor('src/b/util.js', 'format'),
  ];
  const statements = [
    statement([
      { file_path: 'src/orders/service.js', symbol: 'format', link_status: 'healthy' },
    ]),
  ];

  const { statements: out, triage } = reconcileLinks({ anchors, statements });

  const link = out[0].links[0];
  assert.equal(link.link_status, 'needs_relink');
  assert.equal(link.file_path, 'src/orders/service.js');
  assert.equal(triage.length, 1);
});

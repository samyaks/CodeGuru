'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { addAgreement, renderAgentFiles, agreementId, AgreementError, validateText, MARKER_START } = require('../lib');

const v2 = fs.readFileSync(path.join(__dirname, 'fixtures', 'v2.yaml'), 'utf8');
const v1 = fs.readFileSync(path.join(__dirname, 'fixtures', 'v1.yaml'), 'utf8');
const areaId = validateText(v2).data.areas[0].id;

const agreement = (over = {}) => ({
  id: 'agr_2026_11_25_ship_dark_mode_ab12', text: 'Ship dark mode before the pricing page.', area: areaId,
  agreed_by: ['sam@acme.test', 'olive@acme.test'], agreed_on: '2026-11-25', ...over,
});

test('ids are stable, readable and valid', () => {
  assert.strictEqual(agreementId('2026-11-25', 'Ship dark mode before the pricing page!', 'Ab12'), 'agr_2026_11_25_ship_dark_mode_before_ab12');
  assert.strictEqual(agreementId('2026-11-25', '!!!', 'x9'), 'agr_2026_11_25_x9');
});

test('adding an agreement keeps comments and the rest of the file, and validates', () => {
  const withComment = `# Our intent. Keep this comment.\n${v2}`;
  const { text, data, alreadyThere } = addAgreement(withComment, agreement());
  assert.strictEqual(alreadyThere, false);
  assert.ok(text.startsWith('# Our intent. Keep this comment.\n'));
  const added = data.agreements.find((a) => a.id === 'agr_2026_11_25_ship_dark_mode_ab12');
  assert.deepStrictEqual(added, agreement());
  assert.strictEqual(validateText(text).issues.filter((i) => i.severity === 'error').length, 0);
  // The agreements that were there are still there.
  assert.ok(data.agreements.length >= 2);

  // Adding it twice changes nothing.
  const again = addAgreement(text, agreement());
  assert.strictEqual(again.alreadyThere, true);
  assert.strictEqual(again.text, text);
});

test('a file with no agreements list gets one', () => {
  const bare = 'version: 2\nproduct:\n  name: Bare\n  summary: Nothing yet.\n';
  const { data } = addAgreement(bare, agreement({ area: undefined }));
  assert.deepStrictEqual(data.agreements.map((a) => a.id), ['agr_2026_11_25_ship_dark_mode_ab12']);
});

test('v1 files, broken files and bad agreements are refused with a reason', () => {
  assert.throws(() => addAgreement(v1, agreement()), (e) => e instanceof AgreementError && e.code === 'needs_migrate');
  assert.throws(() => addAgreement('version: 2\nproduct: [', agreement()), (e) => e.code === 'invalid_yaml');
  assert.throws(() => addAgreement(v2, agreement({ area: 'no-such-area' })), (e) => e.code === 'invalid_agreement');
  assert.throws(() => addAgreement(v2, agreement({ agreed_by: ['not-an-email'] })), (e) => e.code === 'invalid_agreement');
});

test('agent files carry the new agreement and keep hand-written text', () => {
  const { data } = addAgreement(v2, agreement());
  const files = renderAgentFiles(data, { 'CLAUDE.md': '# Hand-written\n', 'AGENTS.md': null });
  const claude = files.find((f) => f.path === 'CLAUDE.md');
  assert.ok(claude.text.startsWith('# Hand-written\n'));
  assert.ok(claude.text.includes('Ship dark mode before the pricing page.'));
  assert.ok(files.every((f) => f.changed && f.text.includes(MARKER_START)));
  assert.deepStrictEqual(files.map((f) => f.path), ['CLAUDE.md', 'AGENTS.md', '.cursor/rules/takeoff.mdc']);
  assert.throws(() => renderAgentFiles(data, { 'CLAUDE.md': `${MARKER_START}\n${MARKER_START}\n` }), (e) => e.code === 'broken_markers');
});

test('adding an agreement keeps the file layout: unindented lists, unpadded flow lists, empty list', () => {
  const src = [
    'version: 2',
    'product:',
    '  name: Acme',
    '  summary: "A web app."',
    'areas:',
    '- id: billing',
    '  name: Billing',
    '  paths: ["src/billing/**"]',
    '  creators: [sam@acme.test]',
    'agreements: []',
    '',
  ].join('\n');
  const { text } = addAgreement(src, agreement({ area: 'billing', agreed_by: ['sam@acme.test'] }));
  const before = src.split('\n').slice(0, 9).join('\n');
  assert.ok(text.startsWith(before), text);
  assert.match(text, /\nagreements:\n- id: agr_2026_11_25_ship_dark_mode_ab12\n/);
});

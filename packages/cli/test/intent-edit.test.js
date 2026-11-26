'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { applyIntentEdits, IntentEditError, validateText } = require('../lib');

const yaml = `version: 2
# Keep this comment.
product:
  name: Delta-V
  summary: Outreach for law firms.
areas:
  - id: billing
    name: Billing
    paths: ["src/billing/**"]
    creators: ["sam@acme.test"]
    rules:
      - "Stripe holds all billing data."
      - id: no-cards
        text: "We never store card numbers."
    never:
      - "Charge before the trial ends."
  - id: emails
    name: Emails
    paths: ["src/email/**"]
agreements:
  - id: agr_2026_11_20_weekly_digest_ab12
    area: emails
    text: "Send a weekly digest, not daily."
    agreed_by: ["sam@acme.test"]
    agreed_on: "2026-11-20"
`;

const rule = (text, area = 'billing', kind = 'rule') => ({ kind, area, text });

test('removes a plain rule and keeps comments and the rest', () => {
  const { text, data, summary } = applyIntentEdits(yaml, [{ op: 'remove', target: rule('Stripe holds all billing data.') }]);
  assert.ok(text.includes('# Keep this comment.'));
  const billing = data.areas.find((a) => a.id === 'billing');
  assert.deepStrictEqual(billing.rules, [{ id: 'no-cards', text: 'We never store card numbers.' }]);
  assert.deepStrictEqual(billing.never, ['Charge before the trial ends.']);
  assert.strictEqual(summary.length, 1);
});

test('rewords a rule written as a map, keeping its id', () => {
  const { data } = applyIntentEdits(yaml, [{ op: 'reword', target: rule('We never store card numbers.'), to: 'Card numbers stay with Stripe.' }]);
  const billing = data.areas.find((a) => a.id === 'billing');
  assert.deepStrictEqual(billing.rules[1], { id: 'no-cards', text: 'Card numbers stay with Stripe.' });
});

test('matches text with different whitespace, and finds never-rules and agreements', () => {
  const { data } = applyIntentEdits(yaml, [
    { op: 'remove', target: rule('Charge  before the\ntrial ends.', 'billing', 'never') },
    { op: 'reword', target: { kind: 'agreement', area: 'emails', text: 'Send a weekly digest, not daily.' }, to: 'Send a daily digest.' },
  ]);
  assert.deepStrictEqual(data.areas.find((a) => a.id === 'billing').never, []);
  assert.strictEqual(data.agreements[0].text, 'Send a daily digest.');
  assert.ok(validateText(applyIntentEdits(yaml, [{ op: 'remove', target: rule('Charge before the trial ends.', 'billing', 'never') }]).text).ok);
});

test('adds a rule to an area with no rules list yet', () => {
  const { data } = applyIntentEdits(yaml, [{ op: 'add', kind: 'rule', area: 'emails', text: 'Every email has an unsubscribe link.' }]);
  assert.deepStrictEqual(data.areas.find((a) => a.id === 'emails').rules, ['Every email has an unsubscribe link.']);
});

test('several removals from one list remove the right items', () => {
  const two = yaml.replace('      - "Stripe holds all billing data."\n', '      - "Stripe holds all billing data."\n      - "Refunds within 30 days."\n');
  const { data } = applyIntentEdits(two, [
    { op: 'remove', target: rule('Stripe holds all billing data.') },
    { op: 'remove', target: rule('We never store card numbers.') },
  ]);
  assert.deepStrictEqual(data.areas.find((a) => a.id === 'billing').rules, ['Refunds within 30 days.']);
});

test('refuses edits that miss, repeat, or would break the file', () => {
  const code = (edits, src = yaml) => {
    try { applyIntentEdits(src, edits); return null; } catch (e) { assert.ok(e instanceof IntentEditError); return e.code; }
  };
  assert.strictEqual(code([{ op: 'remove', target: rule('Not a rule.') }]), 'not_found');
  assert.strictEqual(code([{ op: 'remove', target: rule('Stripe holds all billing data.', 'nope') }]), 'area_not_found');
  assert.strictEqual(code([{ op: 'remove', target: rule('Stripe holds all billing data.') }, { op: 'reword', target: rule('Stripe holds all billing data.'), to: 'x' }]), 'bad_edit');
  assert.strictEqual(code([]), 'bad_edit');
  assert.strictEqual(code([{ op: 'reword', target: rule('Stripe holds all billing data.'), to: 'Stripe holds all billing data.' }]), 'bad_edit');
  assert.strictEqual(code([{ op: 'add', kind: 'rule', area: 'billing', text: 'Stripe holds all billing data.' }]), 'bad_edit');
  assert.strictEqual(code([{ op: 'add', kind: 'agreement', area: 'billing', text: 'x' }]), 'bad_edit');
  assert.strictEqual(code([{ op: 'remove', target: rule('x') }], 'version: 2\nareas: [oops'), 'invalid_yaml');
  assert.strictEqual(code([{ op: 'reword', target: rule('Stripe holds all billing data.'), to: 'y'.repeat(1001) }]), 'bad_edit');
});

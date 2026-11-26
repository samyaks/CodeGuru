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
    { op: 'remove', target: { kind: 'agreement', area: 'emails', text: 'Send a  weekly digest, not daily.' } },
  ]);
  assert.deepStrictEqual(data.areas.find((a) => a.id === 'billing').never, []);
  assert.deepStrictEqual(data.agreements, []);
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

test('an agreement is never reworded, since people agreed to its exact words', () => {
  assert.throws(
    () => applyIntentEdits(yaml, [{ op: 'reword', target: { kind: 'agreement', area: 'emails', text: 'Send a weekly digest, not daily.' }, to: 'Send a daily digest.' }]),
    (e) => e instanceof IntentEditError && e.code === 'bad_edit' && /can't be reworded/.test(e.message),
  );
});

test('a reword keeps the comments and quoting around the rule, and the rest of the file as written', () => {
  const commented = yaml.replace('      - "Stripe holds all billing data."\n', '      # about where data lives\n      - "Stripe holds all billing data." # checked in Q3\n');
  const { text } = applyIntentEdits(commented, [{ op: 'reword', target: rule('Stripe holds all billing data.'), to: 'Stripe and our ledger hold billing data.' }]);
  assert.match(text, /# about where data lives\n {6}- "Stripe and our ledger hold billing data." # checked in Q3\n/);
  assert.ok(text.includes('paths: ["src/billing/**"]'), 'flow lists are not re-padded');
  const mapped = applyIntentEdits(yaml, [{ op: 'reword', target: rule('We never store card numbers.'), to: 'We never store or log card numbers.' }]);
  assert.match(mapped.text, /text: "We never store or log card numbers."/);
});

test('a reword cannot make a rule a duplicate of another', () => {
  assert.throws(
    () => applyIntentEdits(yaml, [{ op: 'reword', target: rule('Stripe holds all billing data.'), to: 'We never store card numbers.' }]),
    (e) => e instanceof IntentEditError && /already a rule/.test(e.message),
  );
});

test('a removal that would break an alias is refused, not thrown raw', () => {
  const aliased = yaml.replace('      - "Stripe holds all billing data."\n', '      - &stripe "Stripe holds all billing data."\n').replace('    paths: ["src/email/**"]\n', '    paths: ["src/email/**"]\n    rules:\n      - *stripe\n');
  assert.throws(
    () => applyIntentEdits(aliased, [{ op: 'remove', target: rule('Stripe holds all billing data.') }]),
    (e) => e instanceof IntentEditError,
  );
});

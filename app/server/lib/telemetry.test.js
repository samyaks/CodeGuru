const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateWaitlist, validateEvents, MAX_EVENTS_PER_BATCH } = require('./telemetry');

test('validateWaitlist: lowercases and trims a valid email', () => {
  const r = validateWaitlist({ email: '  Sam@Example.COM ', source: 'pricing' });
  assert.equal(r.ok, true);
  assert.equal(r.value.email, 'sam@example.com');
  assert.equal(r.value.source, 'pricing');
  assert.equal(r.value.note, null);
});

test('validateWaitlist: rejects missing or malformed emails', () => {
  for (const email of [undefined, '', 'nope', 'a@b', 'a b@c.com', 42]) {
    const r = validateWaitlist({ email });
    assert.equal(r.ok, false, `expected ${JSON.stringify(email)} to fail`);
  }
});

test('validateWaitlist: truncates an oversized note instead of failing', () => {
  const r = validateWaitlist({ email: 'a@b.co', note: 'x'.repeat(5000) });
  assert.equal(r.ok, true);
  assert.equal(r.value.note.length, 1000);
});

test('validateEvents: accepts known events and normalises fields', () => {
  const r = validateEvents({
    sessionId: 'abc',
    events: [
      { event: 'landing_viewed', path: '/', referrer: 'https://x.test' },
      { event: 'prompt_copied', projectId: 'p1', metadata: { source: 'frame' } },
    ],
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.sessionId, 'abc');
  assert.equal(r.value.events.length, 2);
  assert.deepEqual(r.value.events[1], {
    event: 'prompt_copied',
    projectId: 'p1',
    path: null,
    referrer: null,
    metadata: { source: 'frame' },
  });
});

test('validateEvents: rejects unknown event names', () => {
  const r = validateEvents({ sessionId: 's', events: [{ event: 'made_up' }] });
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown event/);
});

test('validateEvents: requires a sessionId and a non-empty array', () => {
  assert.equal(validateEvents({ events: [{ event: 'landing_viewed' }] }).ok, false);
  assert.equal(validateEvents({ sessionId: 's', events: [] }).ok, false);
  assert.equal(validateEvents({ sessionId: 's', events: 'nope' }).ok, false);
});

test('validateEvents: caps the batch size', () => {
  const events = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ({ event: 'landing_viewed' }));
  const r = validateEvents({ sessionId: 's', events });
  assert.equal(r.ok, false);
});

test('validateEvents: rejects non-object or oversized metadata', () => {
  assert.equal(validateEvents({ sessionId: 's', events: [{ event: 'landing_viewed', metadata: [1] }] }).ok, false);
  assert.equal(validateEvents({ sessionId: 's', events: [{ event: 'landing_viewed', metadata: 'str' }] }).ok, false);
  const big = { blob: 'x'.repeat(3000) };
  assert.equal(validateEvents({ sessionId: 's', events: [{ event: 'landing_viewed', metadata: big }] }).ok, false);
});

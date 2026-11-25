'use strict';

// Agreement emails. Events go into an outbox; a background flusher sends
// them. One person gets at most 3 single emails in an hour: anything more in
// that hour goes out together as one digest (and at most one digest an hour).
//
// Sending is off until an email provider is configured:
//   TAKEOFF_EMAIL_PROVIDER=resend, RESEND_API_KEY, TAKEOFF_EMAIL_FROM
// (plain HTTPS to Resend's API; no new dependency). With no provider nothing
// is queued, so turning it on later doesn't send a backlog.

const crypto = require('crypto');

const SINGLES_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

function transportFromEnv(env = process.env, fetchImpl = globalThis.fetch) {
  const provider = (env.TAKEOFF_EMAIL_PROVIDER || '').trim().toLowerCase();
  if (provider !== 'resend') return null;
  const key = (env.RESEND_API_KEY || '').trim();
  const from = (env.TAKEOFF_EMAIL_FROM || '').trim();
  if (!key || !from) {
    console.warn('[agreements] TAKEOFF_EMAIL_PROVIDER=resend needs RESEND_API_KEY and TAKEOFF_EMAIL_FROM; emails stay off.');
    return null;
  }
  return {
    async send({ to, subject, text }) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text }),
      });
      if (!res.ok) throw new Error(`email provider ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

/**
 * Queue one email per recipient.
 * @param {Array<{ userId: string, email: string|null }>} recipients
 */
async function enqueue({ projectId, recipients, kind, subject, body, link }, deps) {
  if (!deps.emailEnabled) return 0;
  let n = 0;
  const seen = new Set();
  for (const r of recipients) {
    const email = String(r.email || '').trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    await deps.notificationOutbox.enqueue({
      id: crypto.randomUUID(), projectId, userId: r.userId, email, kind,
      subject: subject.slice(0, 200), body: body.slice(0, 4000), link,
    });
    n += 1;
  }
  return n;
}

const withLink = (n) => (n.link ? `${n.body}\n\n${n.link}` : n.body);

function digestOf(items) {
  return {
    subject: `${items.length} updates on agreements in Takeoff`,
    text: [
      `There were ${items.length} updates on agreements in your Takeoff projects:`,
      '',
      ...items.map((n) => `- ${n.subject}${n.link ? `\n  ${n.link}` : ''}`),
    ].join('\n'),
  };
}

/** Send what's due. Returns how many emails went out. */
async function flush(deps) {
  if (!deps.transport) return 0;
  const now = deps.now();
  let sent = 0;
  for (const email of await deps.notificationOutbox.pendingRecipients()) {
    const items = await deps.notificationOutbox.unsentFor(email);
    if (!items.length) continue;
    const { singles, digests } = await deps.notificationOutbox.sentSince(email, new Date(now.getTime() - HOUR_MS).toISOString());
    const ids = items.map((n) => n.id);
    try {
      if (!digests && singles + items.length <= SINGLES_PER_HOUR) {
        for (const n of items) {
          await deps.transport.send({ to: email, subject: n.subject, text: withLink(n) });
          await deps.notificationOutbox.markSent([n.id]);
          sent += 1;
        }
      } else if (!digests) {
        // The hour's one digest (a digest of one is just that email).
        const d = items.length === 1 ? { subject: items[0].subject, text: withLink(items[0]) } : digestOf(items);
        await deps.transport.send({ to: email, subject: d.subject, text: d.text });
        await deps.notificationOutbox.markSent(ids, crypto.randomUUID());
        sent += 1;
      }
      // Otherwise this hour's singles and digest are used up: wait.
    } catch (err) {
      console.warn('[agreements] email send failed:', err.message);
      await deps.notificationOutbox.markFailed(ids, err.message).catch(() => {});
    }
  }
  return sent;
}

/** Start the background flusher. Returns a stop function. */
function startFlusher(deps, { everyMs = 2 * 60 * 1000 } = {}) {
  if (!deps.transport) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await flush(deps); } catch (err) { console.warn('[agreements] email flush failed:', err.message); } finally { running = false; }
  };
  const timer = setInterval(tick, everyMs);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}

module.exports = { enqueue, flush, startFlusher, transportFromEnv, digestOf, SINGLES_PER_HOUR };

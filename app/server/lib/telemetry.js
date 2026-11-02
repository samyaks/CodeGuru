// Validation and persistence for the two public write endpoints added in the
// trust pass: waitlist signups and first-party funnel events. The pure
// functions are exported for tests; the store functions touch Postgres.

const crypto = require('crypto');
const { getDb } = require('./db');

// Every event the client may send. Keeping this closed means a typo in the
// client shows up as a 400 in dev instead of a silent hole in the funnel.
const FUNNEL_EVENTS = new Set([
  'landing_viewed',
  'scan_started',
  'scan_ready',
  'scan_failed',
  'read_viewed',
  'build_viewed',
  'prompt_loaded',
  'prompt_copied',
  'sign_in_clicked',
  'waitlist_joined',
  // Intent loop (docs/specs/intent-driven-building.md). prompt_copied carries
  // metadata.source = 'slice' when copied from the slice card.
  'slice_activated',
  'slice_synced',
  'slice_verified',
  'slice_abandoned',
]);

const MAX_EVENTS_PER_BATCH = 20;
const MAX_STR = 512;
const MAX_METADATA_BYTES = 2048;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function str(val, max = MAX_STR) {
  if (typeof val !== 'string') return null;
  const t = val.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * Normalise a waitlist payload. Returns `{ ok: true, value }` or
 * `{ ok: false, error }` so the route can turn it into a 400 without
 * throwing from here.
 */
function validateWaitlist(body) {
  const email = str(body?.email, 254);
  if (!email || !EMAIL_RE.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' };
  }
  return {
    ok: true,
    value: {
      email: email.toLowerCase(),
      source: str(body?.source, 64),
      note: str(body?.note, 1000),
    },
  };
}

/**
 * Normalise a batch of funnel events. Unknown event names, oversized
 * strings and non-object metadata are rejected rather than coerced, so
 * the table only ever holds shapes we chose.
 */
function validateEvents(body) {
  const sessionId = str(body?.sessionId, 64);
  if (!sessionId) return { ok: false, error: 'sessionId is required.' };

  const raw = body?.events;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'events must be a non-empty array.' };
  }
  if (raw.length > MAX_EVENTS_PER_BATCH) {
    return { ok: false, error: `Maximum ${MAX_EVENTS_PER_BATCH} events per batch.` };
  }

  const events = [];
  for (const e of raw) {
    const event = str(e?.event, 64);
    if (!event || !FUNNEL_EVENTS.has(event)) {
      return { ok: false, error: `Unknown event: ${String(e?.event).slice(0, 64)}` };
    }
    let metadata = null;
    if (e?.metadata != null) {
      if (typeof e.metadata !== 'object' || Array.isArray(e.metadata)) {
        return { ok: false, error: 'metadata must be an object.' };
      }
      const json = JSON.stringify(e.metadata);
      if (json.length > MAX_METADATA_BYTES) {
        return { ok: false, error: 'metadata too large.' };
      }
      metadata = e.metadata;
    }
    events.push({
      event,
      projectId: str(e?.projectId, 64),
      path: str(e?.path, MAX_STR),
      referrer: str(e?.referrer, MAX_STR),
      metadata,
    });
  }
  return { ok: true, value: { sessionId, events } };
}

async function addToWaitlist({ email, source, note, userId }) {
  const db = getDb();
  const { rows } = await db.query(
    `INSERT INTO waitlist (id, email, source, note, user_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (lower(email)) DO NOTHING
     RETURNING id`,
    [crypto.randomUUID(), email, source, note, userId || null],
  );
  return { created: rows.length > 0 };
}

async function recordEvents({ sessionId, userId, events }) {
  if (events.length === 0) return 0;
  const db = getDb();
  const values = [];
  const params = [];
  let i = 1;
  for (const e of events) {
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(
      crypto.randomUUID(),
      e.event,
      sessionId,
      userId || null,
      e.projectId,
      e.path,
      e.referrer,
      e.metadata ? JSON.stringify(e.metadata) : null,
    );
  }
  await db.query(
    `INSERT INTO funnel_events (id, event, session_id, user_id, project_id, path, referrer, metadata)
     VALUES ${values.join(', ')}`,
    params,
  );
  return events.length;
}

/**
 * Server-side funnel event. Used where the client can't observe the
 * transition (scan finished, scan failed). Never throws: telemetry must
 * not break the thing it measures.
 */
async function recordServerEvent(event, { projectId = null, userId = null, metadata = null } = {}) {
  if (!FUNNEL_EVENTS.has(event)) return;
  try {
    await recordEvents({
      sessionId: 'server',
      userId,
      events: [{ event, projectId, path: null, referrer: null, metadata }],
    });
  } catch (err) {
    console.warn('[telemetry] failed to record', event, err.message);
  }
}

module.exports = {
  FUNNEL_EVENTS,
  MAX_EVENTS_PER_BATCH,
  validateWaitlist,
  validateEvents,
  addToWaitlist,
  recordEvents,
  recordServerEvent,
};

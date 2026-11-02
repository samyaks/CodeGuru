// First-party funnel events. One random id per browser (localStorage, not a
// cookie), batched and flushed to POST /api/events. Everything here is
// fire-and-forget: a telemetry failure must never surface in the UI.
//
// The event list mirrors FUNNEL_EVENTS on the server; an unknown name is
// rejected there with a 400, so add to both when you add one.

export type FunnelEvent =
  | 'landing_viewed'
  | 'scan_started'
  | 'read_viewed'
  | 'build_viewed'
  | 'prompt_loaded'
  | 'prompt_copied'
  | 'sign_in_clicked'
  | 'waitlist_joined';

interface QueuedEvent {
  event: FunnelEvent;
  projectId?: string | null;
  path: string;
  referrer: string | null;
  metadata?: Record<string, unknown> | null;
}

const SESSION_KEY = 'tf_sid';
const FLUSH_DELAY_MS = 1500;
const MAX_BATCH = 20;

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let sessionId: string | null = null;
// Events that should fire at most once per page load (StrictMode and HMR
// both re-run mount effects in dev; production would fire once anyway).
const firedOnce = new Set<string>();

function getSessionId(): string {
  if (sessionId) return sessionId;
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) {
      sessionId = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, fresh);
    sessionId = fresh;
    return fresh;
  } catch {
    // Storage blocked: still send, just without cross-page continuity.
    sessionId = sessionId ?? crypto.randomUUID();
    return sessionId;
  }
}

function send(events: QueuedEvent[]) {
  if (events.length === 0) return;
  const body = JSON.stringify({ sessionId: getSessionId(), events });
  // sendBeacon survives page unloads (the common case for prompt_copied →
  // tab closed). Fall back to keepalive fetch when it isn't available.
  try {
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon('/api/events', new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
  } catch {
    /* fall through */
  }
  void fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    credentials: 'include',
    keepalive: true,
  }).catch(() => {});
}

function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  const batch = queue;
  queue = [];
  while (batch.length > 0) send(batch.splice(0, MAX_BATCH));
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

/** Record a funnel event. Safe to call anywhere; never throws. */
export function track(
  event: FunnelEvent,
  opts: { projectId?: string | null; metadata?: Record<string, unknown>; once?: boolean } = {},
): void {
  if (typeof window === 'undefined') return;
  try {
    if (opts.once) {
      const key = `${event}:${opts.projectId ?? ''}`;
      if (firedOnce.has(key)) return;
      firedOnce.add(key);
    }
    queue.push({
      event,
      projectId: opts.projectId ?? null,
      path: window.location.pathname,
      referrer: document.referrer || null,
      metadata: opts.metadata ?? null,
    });
    if (queue.length >= MAX_BATCH) flush();
    else scheduleFlush();
  } catch {
    /* never let telemetry break the page */
  }
}

/** Join the waitlist. Resolves true when the server accepted the address. */
export async function joinWaitlist(email: string, source: string, note?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, source, note }),
    });
    if (res.ok) {
      track('waitlist_joined', { metadata: { source } });
      return { ok: true };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: false, error: typeof data?.error === 'string' ? data.error : "That didn't go through. Try again." };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again in a moment." };
  }
}

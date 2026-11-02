-- Trust pass: a real waitlist (the Pricing form used to write to
-- localStorage) and first-party funnel events so the external test in
-- the intent-loop plan can be measured.

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- Where the signup came from: 'pricing' | 'private-repos' | 'landing' …
  source TEXT,
  note TEXT,
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per address, case-insensitive. Re-submitting is a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_lower ON waitlist (lower(email));
CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist (created_at);

CREATE TABLE IF NOT EXISTS funnel_events (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  -- Random per-browser id generated client-side. Not a cookie, not tied to
  -- identity unless the visitor is signed in (then user_id is set too).
  session_id TEXT NOT NULL,
  user_id TEXT,
  project_id TEXT,
  path TEXT,
  referrer TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnel_events_event_created ON funnel_events (event, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_events_session ON funnel_events (session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_funnel_events_project ON funnel_events (project_id) WHERE project_id IS NOT NULL;

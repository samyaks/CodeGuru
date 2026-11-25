-- Milestone 3: async agreements. Proposals and votes live here; an accepted
-- agreement is committed into takeoff.yaml in the repo, which stays the
-- source of truth for intent.

CREATE TABLE IF NOT EXISTS agreements (
  id TEXT PRIMARY KEY,                           -- agr_<date>_<words>_<suffix>, also the id in takeoff.yaml
  project_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  area_id TEXT,
  text TEXT NOT NULL,
  source TEXT,                                   -- optional http(s) link, e.g. the PR it came from
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'declined', 'withdrawn')),
  proposed_by TEXT NOT NULL,
  proposed_by_name TEXT,
  proposed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  decided_via TEXT CHECK (decided_via IN ('everyone_agreed', 'stall_fallback', 'withdrawn')),
  decision_note TEXT,
  agreed_by_emails TEXT[],                       -- frozen at acceptance; goes into takeoff.yaml
  -- Committing the accepted agreement into the repo.
  commit_state TEXT NOT NULL DEFAULT 'none'
    CHECK (commit_state IN ('none', 'waiting_for_write', 'committing', 'committed', 'pr_opened', 'failed')),
  commit_sha TEXT,
  commit_url TEXT,
  commit_pr_url TEXT,
  commit_error TEXT,
  commit_attempted_at TIMESTAMPTZ,
  recommendation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_agreements_project ON agreements (project_id, proposed_at DESC);

CREATE TABLE IF NOT EXISTS agreement_votes (
  agreement_id TEXT NOT NULL REFERENCES agreements(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('agree', 'not_yet')),
  comment TEXT,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agreement_id, user_id),
  CHECK (vote = 'agree' OR (comment IS NOT NULL AND length(btrim(comment)) > 0))
);

-- Emails about agreements, sent by a background flusher so more than 3 in an
-- hour to one person go out as one digest.
CREATE TABLE IF NOT EXISTS notification_outbox (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  link TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  digest_id TEXT,                                -- set when it went out inside a digest
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_outbox_unsent ON notification_outbox (recipient_email, created_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notification_outbox_sent ON notification_outbox (recipient_email, sent_at) WHERE sent_at IS NOT NULL;

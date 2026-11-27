-- 035_ask.sql
-- Milestone 8, PR 1: Ask Takeoff's threads, messages and spend ledger.
--
-- A thread belongs to one member of one project and is private to them.
-- Each question is a 'user' message; its answer is the 'assistant' message
-- that follows. Spend is kept here (cost_usd on the answer) rather than in
-- analysis_llm_calls, which is keyed to an analysis row and rolls up into
-- the scan totals; Ask's caps read from this table alone.
--
-- Deleting a thread must not hand back spend or questions, so messages
-- outlive their thread: the thread link is set to NULL and the helpers
-- blank the text (lib/db.js askThreads.delete). The rows go when the
-- project goes, or when retention removes them after the cap windows.
--
-- status on an answer: 'running' while the agent works, then 'done',
-- 'failed' or 'refused'. A 'running' row left by a crash counts as running
-- for 10 minutes (see lib/db.js askMessages), then stops reserving budget.

CREATE TABLE IF NOT EXISTS ask_threads (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ask_threads_project_user
  ON ask_threads (project_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_threads_updated
  ON ask_threads (updated_at);

CREATE TABLE IF NOT EXISTS ask_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT REFERENCES ask_threads(id) ON DELETE SET NULL,
  -- Denormalised from the thread so the caps are one indexed query.
  project_id  TEXT NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL DEFAULT '',
  sources     JSONB,
  claims      JSONB,
  status      TEXT NOT NULL DEFAULT 'done'
                CHECK (status IN ('running', 'done', 'failed', 'refused')),
  model       TEXT,
  usage       JSONB,
  cost_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ask_messages_thread
  ON ask_messages (thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ask_messages_user_questions
  ON ask_messages (project_id, user_id, created_at) WHERE role = 'user';
CREATE INDEX IF NOT EXISTS idx_ask_messages_project_answers
  ON ask_messages (project_id, created_at) WHERE role = 'assistant';
CREATE INDEX IF NOT EXISTS idx_ask_messages_orphans
  ON ask_messages (created_at) WHERE thread_id IS NULL;

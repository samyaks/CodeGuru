-- Milestone 8 (Ask Takeoff), PR 4: per-person and deployment-wide monthly
-- spend ceilings read the month's answers by person and in all.

CREATE INDEX IF NOT EXISTS idx_ask_messages_user_answers
  ON ask_messages (user_id, created_at) WHERE role = 'assistant';
CREATE INDEX IF NOT EXISTS idx_ask_messages_answers_month
  ON ask_messages (created_at) WHERE role = 'assistant';

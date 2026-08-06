ALTER TABLE memories ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual'
  CHECK (source_type IN ('manual', 'auto'));

ALTER TABLE memories ADD COLUMN review_state TEXT NOT NULL DEFAULT 'active'
  CHECK (review_state IN ('active', 'superseded', 'expired', 'rejected'));

ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'stable_fact'
  CHECK (kind IN ('stable_fact', 'preference', 'channel_lore'));

ALTER TABLE memories ADD COLUMN confidence REAL;
ALTER TABLE memories ADD COLUMN observation_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN last_observed_at TEXT;
ALTER TABLE memories ADD COLUMN subject TEXT;
ALTER TABLE memories ADD COLUMN predicate TEXT;
ALTER TABLE memories ADD COLUMN value TEXT;
ALTER TABLE memories ADD COLUMN subject_key TEXT;
ALTER TABLE memories ADD COLUMN predicate_key TEXT;
ALTER TABLE memories ADD COLUMN value_key TEXT;
ALTER TABLE memories ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_recalled_at TEXT;
ALTER TABLE memories ADD COLUMN retention_days INTEGER;
ALTER TABLE memories ADD COLUMN expires_at TEXT;
ALTER TABLE memories ADD COLUMN superseded_by TEXT;

UPDATE memories
SET last_observed_at = created_at
WHERE last_observed_at IS NULL;

CREATE INDEX memories_active_fact_key
  ON memories(channel_id, subject_key, predicate_key, review_state, deleted_at);

CREATE INDEX memories_auto_expiration
  ON memories(source_type, review_state, expires_at)
  WHERE source_type = 'auto' AND review_state = 'active';

CREATE INDEX memories_history_by_relation
  ON memories(channel_id, subject_key, predicate_key, updated_at DESC);

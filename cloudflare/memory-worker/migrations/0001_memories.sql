CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY NOT NULL,
  channel_id TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  vector_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (vector_state IN ('pending', 'ready', 'delete_pending')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS memories_channel_content_hash_unique
  ON memories(channel_id, content_hash);

CREATE INDEX IF NOT EXISTS memories_active_by_channel
  ON memories(channel_id, deleted_at, created_at DESC);

CREATE INDEX IF NOT EXISTS memories_pending_vector_work
  ON memories(vector_state, updated_at);

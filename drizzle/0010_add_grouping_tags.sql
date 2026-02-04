CREATE TABLE IF NOT EXISTS workspace_tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS workspace_tags_name_idx ON workspace_tags(name);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS chat_tags (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES workspace_tags(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS chat_tags_unique_idx ON chat_tags(chat_id, tag_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_tags_chat_idx ON chat_tags(chat_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_tags_tag_idx ON chat_tags(tag_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sub_chat_tags (
  id TEXT PRIMARY KEY,
  sub_chat_id TEXT NOT NULL REFERENCES sub_chats(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES workspace_tags(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sub_chat_tags_unique_idx ON sub_chat_tags(sub_chat_id, tag_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sub_chat_tags_sub_chat_idx ON sub_chat_tags(sub_chat_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sub_chat_tags_tag_idx ON sub_chat_tags(tag_id);

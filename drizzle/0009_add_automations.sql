CREATE TABLE IF NOT EXISTS automations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_enabled INTEGER DEFAULT 1,
  triggers TEXT NOT NULL DEFAULT '[]',
  agent_prompt TEXT NOT NULL,
  skills TEXT DEFAULT '[]',
  model_id TEXT DEFAULT 'claude-opus-4-20250514',
  actions TEXT NOT NULL DEFAULT '[]',
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_triggered_at INTEGER,
  total_executions INTEGER DEFAULT 0,
  successful_executions INTEGER DEFAULT 0,
  failed_executions INTEGER DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS automation_executions (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  triggered_by TEXT NOT NULL,
  trigger_data TEXT,
  result TEXT,
  error_message TEXT,
  inbox_chat_id TEXT REFERENCES chats(id),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS executions_automation_idx ON automation_executions(automation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS executions_status_idx ON automation_executions(status);

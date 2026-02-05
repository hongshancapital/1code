-- Memory Sessions table (tracks each SubChat session for memory)
CREATE TABLE IF NOT EXISTS `memory_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`chat_id` text REFERENCES `chats`(`id`) ON DELETE CASCADE,
	`sub_chat_id` text REFERENCES `sub_chats`(`id`) ON DELETE CASCADE,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` integer,
	`started_at_epoch` integer,
	`completed_at` integer,
	`completed_at_epoch` integer,
	`summary_request` text,
	`summary_investigated` text,
	`summary_learned` text,
	`summary_completed` text,
	`summary_next_steps` text,
	`summary_notes` text,
	`discovery_tokens` integer DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_sessions_project_idx` ON `memory_sessions` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_sessions_sub_chat_idx` ON `memory_sessions` (`sub_chat_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_sessions_status_idx` ON `memory_sessions` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `memory_sessions_started_at_idx` ON `memory_sessions` (`started_at_epoch`);
--> statement-breakpoint

-- Observations table (records tool call observations)
CREATE TABLE IF NOT EXISTS `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES `memory_sessions`(`id`) ON DELETE CASCADE,
	`project_id` text REFERENCES `projects`(`id`) ON DELETE CASCADE,
	`type` text NOT NULL,
	`title` text,
	`subtitle` text,
	`narrative` text,
	`facts` text,
	`concepts` text,
	`files_read` text,
	`files_modified` text,
	`tool_name` text,
	`tool_call_id` text,
	`prompt_number` integer,
	`discovery_tokens` integer DEFAULT 0,
	`created_at` integer,
	`created_at_epoch` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observations_session_idx` ON `observations` (`session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observations_project_idx` ON `observations` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observations_type_idx` ON `observations` (`type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `observations_created_at_idx` ON `observations` (`created_at_epoch`);
--> statement-breakpoint

-- User Prompts table (records user inputs)
CREATE TABLE IF NOT EXISTS `user_prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL REFERENCES `memory_sessions`(`id`) ON DELETE CASCADE,
	`prompt_number` integer NOT NULL,
	`prompt_text` text NOT NULL,
	`created_at` integer,
	`created_at_epoch` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_prompts_session_idx` ON `user_prompts` (`session_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `user_prompts_created_at_idx` ON `user_prompts` (`created_at_epoch`);
--> statement-breakpoint

-- FTS5 Virtual Tables for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS `observations_fts` USING fts5(
	title,
	subtitle,
	narrative,
	facts,
	concepts,
	content='observations',
	content_rowid='rowid'
);
--> statement-breakpoint

CREATE VIRTUAL TABLE IF NOT EXISTS `user_prompts_fts` USING fts5(
	prompt_text,
	content='user_prompts',
	content_rowid='rowid'
);
--> statement-breakpoint

CREATE VIRTUAL TABLE IF NOT EXISTS `memory_sessions_fts` USING fts5(
	summary_request,
	summary_learned,
	summary_completed,
	summary_next_steps,
	content='memory_sessions',
	content_rowid='rowid'
);
--> statement-breakpoint

-- Triggers to keep FTS tables in sync with main tables

-- observations_fts triggers
CREATE TRIGGER IF NOT EXISTS `observations_ai` AFTER INSERT ON `observations` BEGIN
	INSERT INTO `observations_fts`(rowid, title, subtitle, narrative, facts, concepts)
	VALUES (new.rowid, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `observations_ad` AFTER DELETE ON `observations` BEGIN
	INSERT INTO `observations_fts`(`observations_fts`, rowid, title, subtitle, narrative, facts, concepts)
	VALUES('delete', old.rowid, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `observations_au` AFTER UPDATE ON `observations` BEGIN
	INSERT INTO `observations_fts`(`observations_fts`, rowid, title, subtitle, narrative, facts, concepts)
	VALUES('delete', old.rowid, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
	INSERT INTO `observations_fts`(rowid, title, subtitle, narrative, facts, concepts)
	VALUES (new.rowid, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;
--> statement-breakpoint

-- user_prompts_fts triggers
CREATE TRIGGER IF NOT EXISTS `user_prompts_ai` AFTER INSERT ON `user_prompts` BEGIN
	INSERT INTO `user_prompts_fts`(rowid, prompt_text)
	VALUES (new.rowid, new.prompt_text);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `user_prompts_ad` AFTER DELETE ON `user_prompts` BEGIN
	INSERT INTO `user_prompts_fts`(`user_prompts_fts`, rowid, prompt_text)
	VALUES('delete', old.rowid, old.prompt_text);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `user_prompts_au` AFTER UPDATE ON `user_prompts` BEGIN
	INSERT INTO `user_prompts_fts`(`user_prompts_fts`, rowid, prompt_text)
	VALUES('delete', old.rowid, old.prompt_text);
	INSERT INTO `user_prompts_fts`(rowid, prompt_text)
	VALUES (new.rowid, new.prompt_text);
END;
--> statement-breakpoint

-- memory_sessions_fts triggers
CREATE TRIGGER IF NOT EXISTS `memory_sessions_ai` AFTER INSERT ON `memory_sessions` BEGIN
	INSERT INTO `memory_sessions_fts`(rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
	VALUES (new.rowid, new.summary_request, new.summary_learned, new.summary_completed, new.summary_next_steps);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `memory_sessions_ad` AFTER DELETE ON `memory_sessions` BEGIN
	INSERT INTO `memory_sessions_fts`(`memory_sessions_fts`, rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
	VALUES('delete', old.rowid, old.summary_request, old.summary_learned, old.summary_completed, old.summary_next_steps);
END;
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `memory_sessions_au` AFTER UPDATE ON `memory_sessions` BEGIN
	INSERT INTO `memory_sessions_fts`(`memory_sessions_fts`, rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
	VALUES('delete', old.rowid, old.summary_request, old.summary_learned, old.summary_completed, old.summary_next_steps);
	INSERT INTO `memory_sessions_fts`(rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
	VALUES (new.rowid, new.summary_request, new.summary_learned, new.summary_completed, new.summary_next_steps);
END;

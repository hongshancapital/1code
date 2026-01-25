CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`project_id` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	`archived_at` integer,
	`worktree_path` text,
	`branch` text,
	`base_branch` text,
	`pr_url` text,
	`pr_number` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chats_worktree_path_idx` ON `chats` (`worktree_path`);--> statement-breakpoint
CREATE TABLE `claude_code_credentials` (
	`id` text PRIMARY KEY DEFAULT 'default' NOT NULL,
	`oauth_token` text NOT NULL,
	`connected_at` integer,
	`user_id` text
);
--> statement-breakpoint
CREATE TABLE `model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_chat_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`project_id` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` text,
	`session_id` text,
	`message_uuid` text,
	`mode` text,
	`duration_ms` integer,
	`created_at` integer,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	`git_remote_url` text,
	`git_provider` text,
	`git_owner` text,
	`git_repo` text,
	`mode` text DEFAULT 'cowork' NOT NULL,
	`feature_config` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_unique` ON `projects` (`path`);--> statement-breakpoint
CREATE TABLE `sub_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`chat_id` text NOT NULL,
	`session_id` text,
	`stream_id` text,
	`mode` text DEFAULT 'agent' NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);

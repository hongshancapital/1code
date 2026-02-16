CREATE TABLE `sub_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_chat_id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`metadata` text,
	`index` integer NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`sub_chat_id`) REFERENCES `sub_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sub_chat_messages_sub_chat_idx` ON `sub_chat_messages` (`sub_chat_id`);--> statement-breakpoint
CREATE INDEX `sub_chat_messages_index_idx` ON `sub_chat_messages` (`sub_chat_id`,`index`);--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `messages_migrated` integer DEFAULT false;--> statement-breakpoint
CREATE INDEX `sub_chats_chat_id_idx` ON `sub_chats` (`chat_id`);--> statement-breakpoint
CREATE INDEX `sub_chats_session_id_idx` ON `sub_chats` (`session_id`);--> statement-breakpoint
CREATE INDEX `executions_started_at_idx` ON `automation_executions` (`started_at`);--> statement-breakpoint
CREATE INDEX `automations_is_enabled_idx` ON `automations` (`is_enabled`);--> statement-breakpoint
CREATE INDEX `chats_project_id_idx` ON `chats` (`project_id`);--> statement-breakpoint
CREATE INDEX `chats_project_archived_updated_idx` ON `chats` (`project_id`,`archived_at`,`updated_at`);--> statement-breakpoint
CREATE INDEX `insights_status_idx` ON `insights` (`status`);--> statement-breakpoint
CREATE INDEX `memory_sessions_chat_id_idx` ON `memory_sessions` (`chat_id`);--> statement-breakpoint
CREATE INDEX `model_usage_created_at_idx` ON `model_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `model_usage_sub_chat_id_idx` ON `model_usage` (`sub_chat_id`);--> statement-breakpoint
CREATE INDEX `model_usage_chat_id_idx` ON `model_usage` (`chat_id`);--> statement-breakpoint
CREATE INDEX `model_usage_project_id_idx` ON `model_usage` (`project_id`);--> statement-breakpoint
CREATE INDEX `model_usage_message_uuid_idx` ON `model_usage` (`message_uuid`);
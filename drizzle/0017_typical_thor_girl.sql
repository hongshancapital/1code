CREATE TABLE `cached_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'llm' NOT NULL,
	`metadata` text,
	`cached_at` integer
);
--> statement-breakpoint
CREATE INDEX `cached_models_provider_idx` ON `cached_models` (`provider_id`);--> statement-breakpoint
CREATE INDEX `cached_models_category_idx` ON `cached_models` (`category`);--> statement-breakpoint
CREATE TABLE `model_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`category` text DEFAULT 'llm' NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`api_key` text NOT NULL,
	`is_enabled` integer DEFAULT true,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `model_providers_category_idx` ON `model_providers` (`category`);--> statement-breakpoint
ALTER TABLE `chats` ADD `manually_renamed` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `model_usage` ADD `source` text;--> statement-breakpoint
ALTER TABLE `sub_chats` ADD `manually_renamed` integer DEFAULT false;
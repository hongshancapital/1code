-- Insights table for storing usage analysis reports (daily/weekly)
CREATE TABLE IF NOT EXISTS `insights` (
	`id` text PRIMARY KEY NOT NULL,
	`report_type` text NOT NULL,
	`report_date` text NOT NULL,
	`stats_json` text NOT NULL,
	`report_markdown` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`error` text,
	`data_dir` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `insights_type_date_idx` ON `insights` (`report_type`,`report_date`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `insights_created_at_idx` ON `insights` (`created_at`);

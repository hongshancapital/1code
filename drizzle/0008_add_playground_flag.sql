-- Migration: Add isPlayground column to projects table for chat mode
-- Playground projects run in {User}/.hong/.playground and don't appear in workspaces
ALTER TABLE `projects` ADD `is_playground` integer DEFAULT 0;

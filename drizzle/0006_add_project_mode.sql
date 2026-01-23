-- Add mode field to projects table
-- "cowork" = simplified mode without git features
-- "coding" = full mode with git/worktree features
ALTER TABLE `projects` ADD `mode` text NOT NULL DEFAULT 'cowork';

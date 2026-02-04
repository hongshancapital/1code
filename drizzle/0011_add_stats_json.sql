-- Add stats_json column to sub_chats table for pre-computed preview stats
-- This avoids parsing large messages JSON when rendering collapsed indicators
ALTER TABLE sub_chats ADD COLUMN stats_json TEXT;

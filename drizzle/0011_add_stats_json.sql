-- Add stats_json column to sub_chats table for pre-computed preview statistics
-- This avoids parsing large messages JSON on every read
ALTER TABLE sub_chats ADD COLUMN stats_json TEXT;

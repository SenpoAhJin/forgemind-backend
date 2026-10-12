/**
 * Migration 020: Chat Display Snapshots and Closed Reason
 * Adds display snapshots for thread participants and listing,
 * plus closed_reason tracking.
 * 
 * Addresses gaps between app types (chat.ts) and existing schema:
 * - listing_title: snapshot at thread creation (listing may be deleted later)
 * - seller/buyer display names: snapshot at thread creation (user may change name)
 * - closed_reason: distinguishes manual close from listing unavailable
 * - closed_by_user_id: tracks who closed the thread
 * - last_message_at: denormalized for sorting threads by activity
 * - last_message_preview: first 60 chars for thread list preview
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE chat_threads
      ADD COLUMN listing_title VARCHAR(200) NOT NULL DEFAULT '',
      ADD COLUMN seller_display_name VARCHAR(100) NOT NULL DEFAULT '',
      ADD COLUMN buyer_display_name VARCHAR(100) NOT NULL DEFAULT '',
      ADD COLUMN closed_reason VARCHAR(30) NULL
        CHECK (closed_reason IN ('closed_by_participant', 'listing_unavailable')),
      ADD COLUMN closed_by_user_id UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      ADD COLUMN last_message_at TIMESTAMPTZ NULL,
      ADD COLUMN last_message_preview VARCHAR(60) NULL;

    -- Remove defaults after adding columns (they were only for non-null constraint)
    ALTER TABLE chat_threads
      ALTER COLUMN listing_title DROP DEFAULT,
      ALTER COLUMN seller_display_name DROP DEFAULT,
      ALTER COLUMN buyer_display_name DROP DEFAULT;

    -- Index for sorting threads by last activity
    CREATE INDEX idx_chat_threads_last_message_at ON chat_threads(last_message_at DESC NULLS LAST);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX IF EXISTS idx_chat_threads_last_message_at;
    ALTER TABLE chat_threads
      DROP COLUMN IF EXISTS last_message_preview,
      DROP COLUMN IF EXISTS last_message_at,
      DROP COLUMN IF EXISTS closed_by_user_id,
      DROP COLUMN IF EXISTS closed_reason,
      DROP COLUMN IF EXISTS buyer_display_name,
      DROP COLUMN IF EXISTS seller_display_name,
      DROP COLUMN IF EXISTS listing_title;
  `);
};

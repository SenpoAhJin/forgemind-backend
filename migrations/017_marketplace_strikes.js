/**
 * Migration 017: Marketplace Strike System
 * 
 * Tracks moderation violations and posting penalties for marketplace users.
 * Strikes accumulate when listings are blocked by content moderation.
 * Penalties escalate from temporary locks to permanent account bans.
 */

exports.up = async (pgm) => {
  await pgm.sql(`
    -- User posting status and cumulative strike count
    CREATE TABLE marketplace_user_status (
      user_id            UUID PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
      strike_count       INTEGER NOT NULL DEFAULT 0,
      posting_locked_until TIMESTAMPTZ NULL,
      banned_at          TIMESTAMPTZ NULL,
      ban_reason         TEXT NULL,
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_marketplace_user_status_posting_locked 
      ON marketplace_user_status(user_id) 
      WHERE posting_locked_until IS NOT NULL;

    CREATE INDEX idx_marketplace_user_status_banned 
      ON marketplace_user_status(user_id) 
      WHERE banned_at IS NOT NULL;

    -- Individual strike records
    CREATE TABLE marketplace_strikes (
      id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      kind               TEXT NOT NULL CHECK (kind IN ('text', 'image')),
      code               TEXT NOT NULL,
      listing_id         UUID NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_marketplace_strikes_user_id ON marketplace_strikes(user_id);
    CREATE INDEX idx_marketplace_strikes_created_at ON marketplace_strikes(created_at);
  `);
};

exports.down = async (pgm) => {
  await pgm.sql(`
    DROP TABLE IF EXISTS marketplace_strikes;
    DROP TABLE IF EXISTS marketplace_user_status;
  `);
};

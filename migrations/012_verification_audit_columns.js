/**
 * Migration 012: Add verification audit columns
 * 
 * Adds missing columns for cosplayer marketplace verification tracking:
 * - verified_by_user_id: FK to users, tracks who approved/rejected
 * - verified_at: timestamp of verification decision
 * - rejection_reason: text explanation when rejected (for marketplace verification)
 * 
 * Note: department_verification has its own rejection_reason column (already exists).
 * This migration adds the marketplace verification rejection_reason.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT
  `);
  
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_users_verified_by 
    ON users(verified_by_user_id) 
    WHERE verified_by_user_id IS NOT NULL
  `);
  
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_users_verification_status 
    ON users(verification_status) 
    WHERE verification_status IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS idx_users_verification_status');
  pgm.sql('DROP INDEX IF EXISTS idx_users_verified_by');
  pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS rejection_reason');
  pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS verified_at');
  pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS verified_by_user_id');
};

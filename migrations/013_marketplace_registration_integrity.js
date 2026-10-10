/**
 * Migration 013: marketplace registration timestamps + integrity guards
 *
 * The registration itself is NOT a new table: migration 001 already put every
 * registration column on `users` (marketplace_role, seller_display_name,
 * marketplace_contact_email, marketplace_contact_phone, payout_method_label,
 * payout_method_number, agreed_to_marketplace_terms, marketplace_submitted_at,
 * marketplace_rejection_reason). This migration reuses them rather than
 * duplicating the same data in a second table.
 *
 * Adds:
 * - marketplace_terms_accepted_at: when T&C was ticked. agreed_to_marketplace_terms
 *   is a boolean with no timestamp, so a rejection could not be dated.
 * - idx_users_marketplace_pending: partial index for the Head pending queue.
 * - A digits-only CHECK on payout_method_number, added NOT VALID on purpose:
 *   it is enforced for every new or updated row, and rows written by older
 *   clients (before the numeric input fix) are not re-checked, so this
 *   migration cannot fail on existing data.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS marketplace_terms_accepted_at TIMESTAMPTZ
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_users_marketplace_pending
      ON users (marketplace_submitted_at DESC)
      WHERE verification_status = 'pending' AND marketplace_role IS NOT NULL
  `);

  // NOT VALID: enforced on insert/update, existing rows grandfathered.
  pgm.sql(`
    ALTER TABLE users
      DROP CONSTRAINT IF EXISTS users_payout_method_number_digits,
      ADD CONSTRAINT users_payout_method_number_digits
      CHECK (payout_method_number IS NULL OR payout_method_number ~ '^[0-9]{7,20}$')
      NOT VALID
  `);
};

exports.down = (pgm) => {
  pgm.sql('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_payout_method_number_digits');
  pgm.sql('DROP INDEX IF EXISTS idx_users_marketplace_pending');
  pgm.sql('ALTER TABLE users DROP COLUMN IF EXISTS marketplace_terms_accepted_at');
};

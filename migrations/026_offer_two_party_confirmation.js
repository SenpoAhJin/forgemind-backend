/**
 * Migration 026: Offer Two-Party Confirmation
 *
 * Implements two-party confirmation pattern for marketplace offers:
 * 1. Add proposer_confirmed_at and recipient_confirmed_at TIMESTAMPTZ columns to structured_offers
 * 2. Extend status enum to include 'awaiting_confirmation' and 'completed'
 * 3. Extend audit_events.action enum to include 'confirm_buyer', 'confirm_seller', 'complete'
 *
 * Design: Mirrors trades table pattern from migration 021. After accept, both parties must
 * confirm before inventory transfer. Confirmation timestamps document dual agreement.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Add confirmation timestamp columns to structured_offers
  pgm.sql(`
    ALTER TABLE structured_offers
      ADD COLUMN proposer_confirmed_at TIMESTAMPTZ NULL,
      ADD COLUMN recipient_confirmed_at TIMESTAMPTZ NULL;
    
    COMMENT ON COLUMN structured_offers.proposer_confirmed_at IS
      'Timestamp when the offer proposer (buyer/trader) confirmed readiness for item transfer. '
      'Mirrors trades.proposer_confirmed_at pattern from migration 021.';
    
    COMMENT ON COLUMN structured_offers.recipient_confirmed_at IS
      'Timestamp when the offer recipient (seller/listing owner) confirmed readiness for item transfer. '
      'Mirrors trades.recipient_confirmed_at pattern from migration 021.';
  `);

  // 2. Extend structured_offers status constraint
  // Drop existing constraint and recreate with extended enum
  pgm.sql(`
    ALTER TABLE structured_offers
      DROP CONSTRAINT IF EXISTS structured_offers_status_check,
      ADD CONSTRAINT structured_offers_status_check
        CHECK (status IN ('pending', 'accepted', 'awaiting_confirmation', 'completed', 'declined', 'withdrawn'));
    
    COMMENT ON CONSTRAINT structured_offers_status_check ON structured_offers IS
      'Status lifecycle: pending → accepted → awaiting_confirmation → completed. '
      'Declined and withdrawn are terminal states from pending or accepted.';
  `);

  // 3. Extend audit_events action constraint
  // Drop existing constraint and recreate with extended enum
  pgm.sql(`
    ALTER TABLE audit_events
      DROP CONSTRAINT IF EXISTS audit_events_action_check,
      ADD CONSTRAINT audit_events_action_check
        CHECK (action IN ('create', 'update', 'delete', 'access', 'export', 'verify', 
                         'confirm_buyer', 'confirm_seller', 'complete'));
    
    COMMENT ON CONSTRAINT audit_events_action_check ON audit_events IS
      'Extended with marketplace confirmation actions: confirm_buyer, confirm_seller, complete. '
      'Used for auditing two-party confirmation flow in offers and trades.';
  `);
};

exports.down = (pgm) => {
  // Restore original audit_events action constraint
  pgm.sql(`
    ALTER TABLE audit_events
      DROP CONSTRAINT IF EXISTS audit_events_action_check,
      ADD CONSTRAINT audit_events_action_check
        CHECK (action IN ('create', 'update', 'delete', 'access', 'export', 'verify'));
  `);

  // Restore original structured_offers status constraint
  pgm.sql(`
    ALTER TABLE structured_offers
      DROP CONSTRAINT IF EXISTS structured_offers_status_check,
      ADD CONSTRAINT structured_offers_status_check
        CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn'));
  `);

  // Remove confirmation timestamp columns
  pgm.sql(`
    ALTER TABLE structured_offers
      DROP COLUMN IF EXISTS proposer_confirmed_at,
      DROP COLUMN IF EXISTS recipient_confirmed_at;
  `);
};

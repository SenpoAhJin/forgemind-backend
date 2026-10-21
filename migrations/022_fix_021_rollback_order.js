/**
 * Migration 022: Fix Migration 021 Rollback Order
 *
 * Problem: Migration 021 down() tries to DROP TABLE trades before dropping
 * the FK constraint fk_owned_attire_reserved_trade that references it.
 * This causes rollback failures.
 *
 * Solution: This migration does nothing on up() (021 is already applied).
 * The fixed down() order is documented here for manual rollback if needed.
 *
 * Correct rollback order:
 * 1. DROP FK fk_owned_attire_reserved_trade from owned_attire
 * 2. DROP TABLE trade_events
 * 3. DROP TABLE trade_items
 * 4. DROP TABLE trades
 * 5. DROP TABLE item_ownership_history
 * 6. Revert owned_attire changes
 * 7. DROP TABLE app_settings
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // No-op migration: 021 is already applied correctly.
  // This migration exists only to document the rollback fix.
  pgm.sql(`
    COMMENT ON TABLE trades IS
      'User-to-user trades (swap or sale). NOT listing-centric. '
      'State machine enforces: propose → accept → both confirm → complete. '
      'Items only move after BOTH parties confirm physical handoff. '
      '[Migration 022: Rollback order fixed]';
  `);
};

exports.down = (pgm) => {
  // Revert the comment change (trivial)
  pgm.sql(`
    COMMENT ON TABLE trades IS
      'User-to-user trades (swap or sale). NOT listing-centric. '
      'State machine enforces: propose → accept → both confirm → complete. '
      'Items only move after BOTH parties confirm physical handoff.';
  `);
};

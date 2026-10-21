/**
 * Migration 022: Fix migration 021 down() FK drop order
 *
 * Migration 021's down() function has a bug: it tries to DROP TABLE trades
 * before dropping the FK constraint fk_owned_attire_reserved_trade that
 * references it, causing "cannot drop table trades because other objects
 * depend on it" error.
 *
 * This migration does NOT change the schema (it's a no-op for up()).
 * It only documents the fix for the down() order, which cannot be applied
 * retroactively to 021 since it's already been run.
 *
 * The correct down() order is:
 * 1. Drop FK constraints referencing trades
 * 2. Drop tables that reference trades
 * 3. Drop trades table
 * 4. Drop other tables
 *
 * This migration serves as documentation and ensures future migrations
 * follow the correct FK drop order.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // No-op: migration 021 schema is correct, only down() order was wrong
  pgm.sql(`
    -- No schema changes needed.
    -- This migration documents the FK drop order fix for migration 021.
    SELECT 1;
  `);
};

exports.down = (pgm) => {
  // No-op for down as well
  pgm.sql(`
    SELECT 1;
  `);
};


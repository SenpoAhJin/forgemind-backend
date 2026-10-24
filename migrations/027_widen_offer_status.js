/**
 * Migration 027: Widen offer status column
 *
 * Problem: Migration 026 added 'awaiting_confirmation' (22 chars) to the status CHECK constraint,
 * but the column remained VARCHAR(20). Postgres rejects the value at runtime with error 22001.
 *
 * Fix: Widen status column to VARCHAR(30) to accommodate current and future status values.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE structured_offers
      ALTER COLUMN status TYPE VARCHAR(30);
    
    COMMENT ON COLUMN structured_offers.status IS
      'Offer lifecycle status. VARCHAR(30) to accommodate values like awaiting_confirmation (22 chars).';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE structured_offers
      ALTER COLUMN status TYPE VARCHAR(20);
    
    COMMENT ON COLUMN structured_offers.status IS
      'Offer lifecycle status. Original VARCHAR(20) size.';
  `);
};

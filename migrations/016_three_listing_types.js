/**
 * Migration 016: Three Transaction Types
 *
 * Simplifies marketplace to three types: sell, trade, commission.
 * Removes buy, rent, service_offer, service_request.
 * Re-maps seeded listings by category and transaction_type.
 */

exports.up = async (pgm) => {
  // Update seeded listings
  // Service categories → commission
  await pgm.sql(`
    UPDATE listings
    SET post_type = 'commission'
    WHERE category_id IN (
      SELECT category_id FROM permitted_categories 
      WHERE category_name IN ('Commissions & Crafting Services', 'Photography Services')
    )
  `);

  // Item categories: transaction_type = 'trade' → trade, everything else → sell
  await pgm.sql(`
    UPDATE listings
    SET post_type = 'trade'
    WHERE category_id IN (
      SELECT category_id FROM permitted_categories 
      WHERE category_name NOT IN ('Commissions & Crafting Services', 'Photography Services')
    )
    AND transaction_type = 'trade'
  `);

  await pgm.sql(`
    UPDATE listings
    SET post_type = 'sell'
    WHERE category_id IN (
      SELECT category_id FROM permitted_categories 
      WHERE category_name NOT IN ('Commissions & Crafting Services', 'Photography Services')
    )
    AND transaction_type IN ('buy', 'both')
  `);

  // Add CHECK constraint for three types
  pgm.sql(`
    ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_post_type_check
  `);

  pgm.sql(`
    ALTER TABLE listings
    ADD CONSTRAINT listings_post_type_three_types_check
    CHECK (post_type IN ('sell', 'trade', 'commission'))
  `);
};

exports.down = async (pgm) => {
  // Remove three-type constraint
  pgm.sql(`
    ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_post_type_three_types_check
  `);

  // Restore original six-type constraint
  pgm.sql(`
    ALTER TABLE listings
    ADD CONSTRAINT listings_post_type_check
    CHECK (post_type IN ('sell', 'buy', 'trade', 'rent', 'service_offer', 'service_request'))
  `);

  // Revert mappings (best effort - can't recover original buy/service_offer)
  pgm.sql(`
    UPDATE listings
    SET post_type = 'service_offer'
    WHERE post_type = 'commission'
  `);

  pgm.sql(`
    UPDATE listings
    SET post_type = 'sell'
    WHERE post_type IN ('trade', 'sell')
  `);
};

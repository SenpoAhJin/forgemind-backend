/**
 * Migration 023: Offer-to-Trade Bridge
 *
 * Enables listings to reference owned inventory items and structured offers
 * to link to executed trades.
 *
 * Changes:
 * 1. listings.item_id: uuid NULL FK to owned_attire
 *    - For sell/trade listings: must reference caller's owned item with status 'free'
 *    - For commission listings: remains NULL
 *    - Partial unique constraint on (item_id) WHERE listing_status = 'active'
 *      (one active listing per inventory item)
 *
 * 2. offer_items table:
 *    - Links structured_offers.id to multiple owned_attire items
 *    - Supports multi-item offers
 *
 * 3. trades.offer_id: uuid NULL FK to structured_offers, UNIQUE
 *    - Links executed trade back to the offer that created it
 *    - One trade per offer (1:1 relationship)
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Add listings.item_id column
  pgm.addColumn('listings', {
    item_id: {
      type: 'uuid',
      notNull: false,
      references: 'owned_attire',
      onDelete: 'SET NULL',
      comment: 'References owned_attire for sell/trade listings; NULL for commission'
    }
  });

  // Create index on item_id for FK lookups
  pgm.createIndex('listings', 'item_id', {
    name: 'idx_listings_item_id'
  });

  // Partial unique constraint: one active listing per inventory item
  pgm.addConstraint('listings', 'uq_listings_item_id_active', {
    unique: ['item_id'],
    where: "listing_status = 'active' AND item_id IS NOT NULL"
  });

  // 2. Create offer_items junction table
  pgm.createTable('offer_items', {
    offer_id: {
      type: 'uuid',
      notNull: true,
      references: 'structured_offers',
      onDelete: 'CASCADE'
    },
    item_id: {
      type: 'uuid',
      notNull: true,
      references: 'owned_attire',
      onDelete: 'CASCADE'
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()')
    }
  });

  // Primary key on junction table
  pgm.addConstraint('offer_items', 'pk_offer_items', {
    primaryKey: ['offer_id', 'item_id']
  });

  // Indexes for FK lookups
  pgm.createIndex('offer_items', 'offer_id', {
    name: 'idx_offer_items_offer_id'
  });

  pgm.createIndex('offer_items', 'item_id', {
    name: 'idx_offer_items_item_id'
  });

  // 3. Add trades.offer_id column with UNIQUE constraint
  pgm.addColumn('trades', {
    offer_id: {
      type: 'uuid',
      notNull: false,
      references: 'structured_offers',
      onDelete: 'SET NULL',
      unique: true,
      comment: 'References the structured_offer that created this trade (1:1)'
    }
  });

  // Index for FK lookup (UNIQUE constraint creates index automatically, but explicit for clarity)
  pgm.createIndex('trades', 'offer_id', {
    name: 'idx_trades_offer_id',
    unique: true,
    where: 'offer_id IS NOT NULL'
  });

  pgm.sql(`
    COMMENT ON TABLE offer_items IS 'Junction table linking structured offers to multiple owned_attire items';
    COMMENT ON COLUMN offer_items.offer_id IS 'The offer containing these items';
    COMMENT ON COLUMN offer_items.item_id IS 'An item included in the offer';
  `);
};

exports.down = (pgm) => {
  // Drop in reverse order, respecting FK dependencies
  
  // 1. Drop trades.offer_id column (drops FK constraint and index)
  pgm.dropColumn('trades', 'offer_id');

  // 2. Drop offer_items table (drops all its constraints and indexes)
  pgm.dropTable('offer_items');

  // 3. Drop listings constraints and column
  pgm.dropConstraint('listings', 'uq_listings_item_id_active');
  pgm.dropIndex('listings', 'item_id', { name: 'idx_listings_item_id' });
  pgm.dropColumn('listings', 'item_id');
};

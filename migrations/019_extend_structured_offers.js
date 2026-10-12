/**
 * Migration 019: Extend structured_offers table for app compatibility
 *
 * The app's offer types store additional fields not present in migration 007:
 * - Trade offers: item description, condition, estimated value (app uses text
 *   description instead of offered_item_id reference)
 * - Commission offers: uses commission_description instead of commission_scope
 * - All offers: listing title and price snapshots for display
 *
 * This migration adds the missing fields without removing existing ones, so both
 * the reference-based trade approach (offered_item_id) and the text-based approach
 * (trade_offered_item) can coexist. Future work can consolidate them.
 *
 * CONCURRENCY NOTE: The partial unique index idx_unique_pending_offer already
 * exists from migration 007, preventing duplicate pending offers. Accept logic
 * uses FOR UPDATE row locking in the application code.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Trade offer fields (text-based description instead of FK)
    ALTER TABLE structured_offers
      ADD COLUMN trade_offered_item TEXT NULL,
      ADD COLUMN trade_offered_condition VARCHAR(20) NULL
        CHECK (trade_offered_condition IN ('new', 'like_new', 'good', 'fair', 'well_loved')),
      ADD COLUMN trade_offered_est_value NUMERIC(12,2) NULL;

    -- Commission description field (app uses this name instead of commission_scope)
    ALTER TABLE structured_offers
      ADD COLUMN commission_description TEXT NULL;

    -- Listing snapshots for display (title and price at offer time)
    ALTER TABLE structured_offers
      ADD COLUMN listing_title VARCHAR(200) NULL,
      ADD COLUMN listing_price NUMERIC(12,2) NULL;

    -- Proposer and seller display names (cached for display, not identity)
    ALTER TABLE structured_offers
      ADD COLUMN proposer_display_name VARCHAR(100) NULL,
      ADD COLUMN seller_display_name VARCHAR(100) NULL;

    -- Update constraints: trade offers can use EITHER offered_item_id OR trade_offered_item
    -- (at least one must be present for type='trade')
    ALTER TABLE structured_offers DROP CONSTRAINT IF EXISTS chk_trade_has_item;
    ALTER TABLE structured_offers ADD CONSTRAINT chk_trade_has_item_v2
      CHECK (
        (offer_type = 'trade' AND (offered_item_id IS NOT NULL OR trade_offered_item IS NOT NULL))
        OR offer_type != 'trade'
      );

    -- Commission offers can use EITHER commission_scope OR commission_description
    ALTER TABLE structured_offers DROP CONSTRAINT IF EXISTS chk_commission_has_scope;
    ALTER TABLE structured_offers ADD CONSTRAINT chk_commission_has_scope_v2
      CHECK (
        (offer_type = 'commission' AND (commission_scope IS NOT NULL OR commission_description IS NOT NULL)
                                    AND commission_timeline_days IS NOT NULL)
        OR offer_type != 'commission'
      );

    COMMENT ON COLUMN structured_offers.trade_offered_item IS
      'Text description of offered item (alternative to offered_item_id FK). App uses this.';
    COMMENT ON COLUMN structured_offers.commission_description IS
      'Alternative to commission_scope. App uses this field name.';
    COMMENT ON COLUMN structured_offers.listing_title IS
      'Snapshot of listing title at offer creation time for display only.';
    COMMENT ON COLUMN structured_offers.listing_price IS
      'Snapshot of listing price at offer creation time for display only.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE structured_offers
      DROP CONSTRAINT IF EXISTS chk_trade_has_item_v2,
      DROP CONSTRAINT IF EXISTS chk_commission_has_scope_v2;

    -- Restore original constraints
    ALTER TABLE structured_offers ADD CONSTRAINT chk_trade_has_item
      CHECK ((offer_type = 'trade' AND offered_item_id IS NOT NULL) OR offer_type != 'trade');

    ALTER TABLE structured_offers ADD CONSTRAINT chk_commission_has_scope
      CHECK ((offer_type = 'commission' AND commission_scope IS NOT NULL
                                        AND commission_timeline_days IS NOT NULL)
             OR offer_type != 'commission');

    ALTER TABLE structured_offers
      DROP COLUMN IF EXISTS trade_offered_item,
      DROP COLUMN IF EXISTS trade_offered_condition,
      DROP COLUMN IF EXISTS trade_offered_est_value,
      DROP COLUMN IF EXISTS commission_description,
      DROP COLUMN IF EXISTS listing_title,
      DROP COLUMN IF EXISTS listing_price,
      DROP COLUMN IF EXISTS proposer_display_name,
      DROP COLUMN IF EXISTS seller_display_name;
  `);
};

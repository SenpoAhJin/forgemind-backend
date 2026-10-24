/**
 * Migration 028: Backfill Listing item_id References
 *
 * Problem: Migration 023 added listings.item_id column but listing creation code
 * never populated it. All active listings have item_id=NULL, breaking offer completion.
 *
 * Fix: For each active sell/trade listing without item_id, create a placeholder
 * owned_attire item and link it. This unblocks existing listings so offers can complete.
 *
 * Long-term: Listing creation code must be updated to require item_id selection
 * (see OFFER_CONFIRM_INVENTORY_BUG_REPORT.md).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Backfill listings.item_id for sell/trade listings
    -- Defer constraint checking to end of transaction
    SET CONSTRAINTS ALL DEFERRED;
    
    WITH new_items AS (
      INSERT INTO owned_attire (
        user_id,
        entry_method,
        auto_categorized_type,
        auto_categorized_color,
        condition_rating,
        flexibility_tag,
        availability_status,
        notes,
        created_at,
        updated_at
      )
      SELECT 
        l.seller_user_id,
        'text',    -- Entry method (valid values: photo, text, voice)
        'other',   -- Generic type since we don't have detailed info
        NULL,      -- No color info from listing
        CASE 
          WHEN l.condition = 'new' THEN 5
          WHEN l.condition = 'like_new' THEN 4
          WHEN l.condition = 'good' THEN 3
          WHEN l.condition = 'fair' THEN 2
          ELSE 1
        END,
        'as-is-only',  -- Conservative flexibility
        'free',        -- Must be free to be tradable
        'Backfilled from listing: ' || l.item_title || ' (' || l.listing_id || ')',  -- Unique notes per listing
        NOW(),
        NOW()
      FROM listings l
      WHERE l.item_id IS NULL
        AND l.listing_status = 'active'
        AND l.transaction_type IN ('buy', 'trade', 'both')  -- Exclude commissions
        -- Skip broken listings that would fail constraints
        AND NOT (
          l.post_type = 'trade' 
          AND (l.trade_offered_item IS NULL OR btrim(l.trade_offered_item) = '' 
               OR l.trade_wanted_item IS NULL OR btrim(l.trade_wanted_item) = '')
        )
      RETURNING attire_id, user_id, notes
    )
    UPDATE listings l
    SET item_id = ni.attire_id
    FROM new_items ni
    WHERE l.seller_user_id = ni.user_id
      AND ni.notes = 'Backfilled from listing: ' || l.item_title || ' (' || l.listing_id || ')'
      AND l.item_id IS NULL
      AND l.listing_status = 'active'
      AND l.transaction_type IN ('buy', 'trade', 'both');
    
    -- Add comment documenting the backfill
    COMMENT ON COLUMN listings.item_id IS
      'References owned_attire item for sell/trade listings. NULL for commissions. '
      'Migration 028 backfilled missing references for existing listings.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Remove backfilled item_id references and delete placeholder items
    WITH backfilled_listings AS (
      SELECT item_id 
      FROM listings 
      WHERE item_id IS NOT NULL 
        AND listing_status = 'active'
        AND transaction_type IN ('buy', 'trade', 'both')
    )
    DELETE FROM owned_attire
    WHERE attire_id IN (SELECT item_id FROM backfilled_listings)
      AND created_at >= (
        SELECT run_on FROM pgmigrations WHERE name = '028_backfill_listing_item_ids'
      );
    
    -- Note: item_id values are set to NULL by ON DELETE RESTRICT failing
    -- If any items have been traded, rollback will fail (intended behavior)
  `);
};

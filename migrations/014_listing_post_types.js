/**
 * Migration 014: marketplace post types + type-specific listing fields
 *
 * WHY
 * Listings were created by the client and stored in AsyncStorage, so a listing
 * only existed on the device that made it. `listings` already had the moderation
 * columns (screening_result, screening_reason, appeal_status, appeal_message)
 * from migration 007, so this migration adds the post-type model the app's
 * src/types/marketplace.ts already declares, plus the removal columns.
 *
 * ADDED COLUMNS
 *   post_type               sell | buy | trade | rent | service_offer |
 *                           service_request. NOT NULL DEFAULT 'sell'.
 *   budget / rate           money fields for buy, service_request, service_offer
 *   rental_fee, rental_period_days, deposit_note      rent
 *   trade_offered_item, trade_wanted_item, trade_estimated_value   trade
 *   request_deadline        service_request
 *   handoff_method          meetup | courier | either (informational)
 *   open_to_trade           sell: accept trade offers
 *   removed_at, removed_reason                        removal audit
 *   screener_version        which screener version judged the row
 *   blocked_by_rescreen     true when a later screener version blocked it
 *
 * KEPT FOR COMPATIBILITY
 * transaction_type is NOT dropped. It is still NOT NULL with its own CHECK, so
 * leaving it in place is the safe choice; the API writes a compatible value and
 * reads post_type.
 *
 * BACKFILL (from the existing transaction_type values)
 *   buy    -> buy
 *   trade  -> trade   (price is not required for a trade)
 *   both   -> sell    with open_to_trade = true, which is what 'both' meant
 *
 * PER-TYPE CHECK CONSTRAINTS
 * Added NOT VALID on purpose, exactly like users_payout_method_number_digits in
 * migration 013: the rule is enforced for every inserted or updated row from now
 * on, and the rows written before this migration are grandfathered rather than
 * re-checked. That keeps this migration safe to run against data this project did
 * not create. `down` drops them, which also removes them from the not-validated
 * set.
 *
 * REPLACED CONSTRAINT
 * chk_listing_price_required (migration 007) is dropped and restored on `down`,
 * because it encodes the old model where a legacy 'buy' listing must have
 * price > 0. Under post_type the money field depends on the post type, so
 * listings_post_type_money takes over that job.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE listings
      ADD COLUMN IF NOT EXISTS post_type VARCHAR(20) NOT NULL DEFAULT 'sell',
      ADD COLUMN IF NOT EXISTS budget NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS rate NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS rental_fee NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS rental_period_days INTEGER NULL,
      ADD COLUMN IF NOT EXISTS deposit_note VARCHAR(500) NULL,
      ADD COLUMN IF NOT EXISTS trade_offered_item VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS trade_wanted_item VARCHAR(200) NULL,
      ADD COLUMN IF NOT EXISTS trade_estimated_value NUMERIC(12,2) NULL,
      ADD COLUMN IF NOT EXISTS request_deadline DATE NULL,
      ADD COLUMN IF NOT EXISTS handoff_method VARCHAR(10) NULL
        CHECK (handoff_method IN ('meetup', 'courier', 'either')),
      ADD COLUMN IF NOT EXISTS open_to_trade BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS removed_at TIMESTAMPTZ NULL,
      ADD COLUMN IF NOT EXISTS removed_reason VARCHAR(30) NULL
        CHECK (removed_reason IN
               ('sold_elsewhere', 'no_longer_available', 'posted_by_mistake', 'other')),
      ADD COLUMN IF NOT EXISTS screener_version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS blocked_by_rescreen BOOLEAN NOT NULL DEFAULT false
  `);

  // The six seeded listings predate post_type. Map each legacy transaction_type
  // onto the post-type model rather than leaving every one of them as 'sell'.
  pgm.sql(`
    UPDATE listings SET post_type = 'buy'   WHERE transaction_type = 'buy';
    UPDATE listings SET post_type = 'trade' WHERE transaction_type = 'trade';
    UPDATE listings SET post_type = 'sell', open_to_trade = true
      WHERE transaction_type = 'both';
  `);

  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS listings_post_type_values,
      ADD CONSTRAINT listings_post_type_values
        CHECK (post_type IN ('sell', 'buy', 'trade', 'rent',
                             'service_offer', 'service_request'))
  `);

  // chk_listing_price_required came from migration 007 and encodes the OLD
  // three-value model: transaction_type 'buy' or 'both' means price > 0. Under
  // post_type that is wrong for every non-item post (a 'rent' or
  // 'service_offer' listing has no price, it has a fee or a rate), so the
  // constraint is replaced by listings_post_type_money below. Migration 007 is
  // not edited; `down` puts the original definition back.
  pgm.sql('ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listing_price_required');

  // NOT VALID: enforced on insert/update, rows written before this migration are
  // grandfathered so the migration cannot fail on existing data.
  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS listings_post_type_money,
      ADD CONSTRAINT listings_post_type_money CHECK (
        (post_type = 'sell'           AND price > 0)
        OR (post_type IN ('buy', 'service_request') AND budget > 0)
        OR (post_type = 'service_offer' AND rate > 0)
        OR (post_type = 'rent'
            AND rental_fee > 0 AND rental_period_days >= 1)
        OR (post_type = 'trade'
            AND trade_offered_item IS NOT NULL AND BTRIM(trade_offered_item) <> ''
            AND trade_wanted_item  IS NOT NULL AND BTRIM(trade_wanted_item)  <> '')
      ) NOT VALID
  `);

  // Range guards that do not depend on the post type, so a bad number is
  // rejected by the database as well as by the API.
  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS listings_post_type_field_limits,
      ADD CONSTRAINT listings_post_type_field_limits CHECK (
        (budget     IS NULL OR budget     >= 0)
        AND (rate       IS NULL OR rate       >= 0)
        AND (rental_fee IS NULL OR rental_fee >= 0)
        AND (rental_period_days IS NULL OR rental_period_days >= 1)
        AND (trade_estimated_value IS NULL OR trade_estimated_value >= 0)
        AND (deposit_note IS NULL OR LENGTH(deposit_note) <= 500)
        AND (trade_offered_item IS NULL OR LENGTH(trade_offered_item) <= 200)
        AND (trade_wanted_item  IS NULL OR LENGTH(trade_wanted_item)  <= 200)
      ) NOT VALID
  `);

  // Browse feed: active rows filtered by post type, newest first.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS idx_listings_status_post_type_created
      ON listings (listing_status, post_type, created_at DESC)
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP INDEX IF EXISTS idx_listings_status_post_type_created');
  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS listings_post_type_field_limits,
      DROP CONSTRAINT IF EXISTS listings_post_type_money,
      DROP CONSTRAINT IF EXISTS listings_post_type_values
  `);
  // Original migration 007 definition, restored verbatim so a down leaves the
  // table exactly as migration 013 left it.
  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS chk_listing_price_required,
      ADD CONSTRAINT chk_listing_price_required
        CHECK (
          (transaction_type IN ('buy', 'both') AND price > 0)
          OR transaction_type = 'trade'
        )
  `);
  pgm.sql(`
    ALTER TABLE listings
      DROP COLUMN IF EXISTS blocked_by_rescreen,
      DROP COLUMN IF EXISTS screener_version,
      DROP COLUMN IF EXISTS removed_reason,
      DROP COLUMN IF EXISTS removed_at,
      DROP COLUMN IF EXISTS open_to_trade,
      DROP COLUMN IF EXISTS handoff_method,
      DROP COLUMN IF EXISTS request_deadline,
      DROP COLUMN IF EXISTS trade_estimated_value,
      DROP COLUMN IF EXISTS trade_wanted_item,
      DROP COLUMN IF EXISTS trade_offered_item,
      DROP COLUMN IF EXISTS deposit_note,
      DROP COLUMN IF EXISTS rental_period_days,
      DROP COLUMN IF EXISTS rental_fee,
      DROP COLUMN IF EXISTS rate,
      DROP COLUMN IF EXISTS budget,
      DROP COLUMN IF EXISTS post_type
  `);
};
/**
 * Domain 7: Marketplace Transactions
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 7: MARKETPLACE TRANSACTIONS"
 * Tables: listings, structured_offers, chat_threads, chat_messages,
 *         transaction_milestones, portfolio_photos  (6)
 *
 * Schema decisions honoured:
 *  - Defect #3: listing_status has NO 'draft'; screening_result uses 'passed' not 'pass'.
 *  - Defect #4: listing-centric offers (purchase / trade / commission).
 *  - Defect #16: UNIQUE per (listing, buyer) chat thread; UNIQUE pending offer per
 *    (listing, proposer); unique index on (listing_id, buyer_user_id).
 *  - chat_messages is AI-EXCLUDED by design — see the comment block below.
 *  - All money is NUMERIC(12,2).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE listings (
      listing_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      seller_user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      item_title        VARCHAR(200) NOT NULL,
      item_description  TEXT NOT NULL,
      category_id       UUID NOT NULL REFERENCES permitted_categories(category_id),
      -- v2.2 RECONCILIATION: ADDED. This column was entirely MISSING from the approved
      -- doc, yet it is a first-class required field in the app:
      --   src/types/marketplace.ts:27  transaction_type: TransactionType
      --   src/types/marketplace.ts:43  required on CreateListingInput
      --   src/contexts/MarketplaceContext.tsx:96 persists it
      --   src/screens/cosplayer/MakeOfferScreen.tsx:308-309 enforces the
      --     offer-vs-listing compatibility rule that depends on it
      -- Net effect: +1 column, no table added, total stays 38 tables.
      transaction_type  VARCHAR(10) NOT NULL
                        CHECK (transaction_type IN ('buy', 'trade', 'both')),
      price             NUMERIC(12,2) NOT NULL,
      price_outlier     VARCHAR(20) NULL
                        CHECK (price_outlier IN
                               ('above-typical', 'below-typical', 'within-range', 'insufficient-data')),
      condition         VARCHAR(20) NOT NULL
                        CHECK (condition IN
                               ('new', 'like_new', 'good', 'fair', 'well_loved')),
      photo_urls        JSONB NULL,
      screening_result  VARCHAR(20) NOT NULL DEFAULT 'passed'
                        CHECK (screening_result IN ('passed', 'blocked')),
      screening_reason  TEXT NULL,
      listing_status    VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (listing_status IN ('active', 'sold', 'cancelled', 'blocked')),
      appeal_status     VARCHAR(20) NOT NULL DEFAULT 'none'
                        CHECK (appeal_status IN ('none', 'pending', 'upheld', 'overturned')),
      appeal_message    TEXT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      published_at      TIMESTAMPTZ NULL,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE structured_offers (
      offer_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id                UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
      proposer_user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      offer_type                VARCHAR(20) NOT NULL
                                CHECK (offer_type IN ('purchase', 'trade', 'commission')),
      status                    VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
      offered_price             NUMERIC(12,2) NULL,
      offered_item_id           UUID NULL REFERENCES listings(listing_id),
      commission_scope          TEXT NULL,
      commission_timeline_days  INTEGER NULL,
      offer_notes               TEXT NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at              TIMESTAMPTZ NULL,
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE chat_threads (
      thread_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id         UUID NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
      buyer_user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      seller_user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      thread_status      VARCHAR(20) NOT NULL DEFAULT 'open'
                         CHECK (thread_status IN ('open', 'closed')),
      buyer_last_read_at TIMESTAMPTZ NULL,
      seller_last_read_at TIMESTAMPTZ NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at          TIMESTAMPTZ NULL
    );

    CREATE TABLE chat_messages (
      message_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id     UUID NOT NULL REFERENCES chat_threads(thread_id) ON DELETE CASCADE,
      sender_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      message_text  TEXT NOT NULL CHECK (LENGTH(message_text) <= 1000),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- CRITICAL PRIVACY RULE (ForgeMind.docx: "Chat content is never read or used as AI input").
    -- The AI/ML service role must hold NO SELECT grant on this table. Enforced at the
    -- database role level, not in application code.
    COMMENT ON TABLE chat_messages IS
      'AI-EXCLUDED. Never joined into or referenced by any AI service query. '
      'Enforce via DB role permissions: the AI service role must have no SELECT grant.';

    CREATE TABLE transaction_milestones (
      milestone_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      offer_id              UUID NOT NULL
                            REFERENCES structured_offers(offer_id) ON DELETE CASCADE,
      milestone_type        VARCHAR(30) NOT NULL
                            CHECK (milestone_type IN
                                   ('payment-sent', 'payment-received', 'item-shipped',
                                    'item-received', 'work-started', 'work-completed')),
      milestone_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                            CHECK (milestone_status IN ('pending', 'confirmed')),
      confirmed_by_user_id  UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      evidence_photo_url    VARCHAR(500) NULL,
      notes                 TEXT NULL,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at          TIMESTAMPTZ NULL
    );

    CREATE TABLE portfolio_photos (
      photo_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      photo_url      VARCHAR(500) NOT NULL,
      caption        TEXT NULL,
      display_order  INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_listings_seller_user_id ON listings(seller_user_id);
    CREATE INDEX idx_listings_category_id ON listings(category_id);
    CREATE INDEX idx_listings_status ON listings(listing_status);
    CREATE INDEX idx_listings_screening_result ON listings(screening_result);
    CREATE INDEX idx_listings_appeal_status ON listings(appeal_status) WHERE appeal_status != 'none';

    CREATE INDEX idx_structured_offers_listing_id ON structured_offers(listing_id);
    CREATE INDEX idx_structured_offers_proposer_user_id ON structured_offers(proposer_user_id);
    CREATE INDEX idx_structured_offers_status ON structured_offers(status);
    -- A3 item 16: one PENDING offer per (listing, proposer)
    CREATE UNIQUE INDEX idx_unique_pending_offer
      ON structured_offers(listing_id, proposer_user_id) WHERE status = 'pending';

    CREATE INDEX idx_chat_threads_listing_id ON chat_threads(listing_id);
    CREATE INDEX idx_chat_threads_buyer_user_id ON chat_threads(buyer_user_id);
    CREATE INDEX idx_chat_threads_seller_user_id ON chat_threads(seller_user_id);
    CREATE INDEX idx_chat_threads_status ON chat_threads(thread_status);
    -- A3 item 16: one thread per (listing, buyer)
    CREATE UNIQUE INDEX idx_unique_chat_thread ON chat_threads(listing_id, buyer_user_id);

    CREATE INDEX idx_chat_messages_thread_id ON chat_messages(thread_id);
    CREATE INDEX idx_chat_messages_created_at ON chat_messages(thread_id, created_at);

    CREATE INDEX idx_transaction_milestones_offer_id ON transaction_milestones(offer_id);
    CREATE INDEX idx_transaction_milestones_status ON transaction_milestones(milestone_status);

    CREATE INDEX idx_portfolio_photos_user_id ON portfolio_photos(user_id);
    CREATE INDEX idx_portfolio_photos_display_order ON portfolio_photos(user_id, display_order);

    -- v2.2 RECONCILIATION: makes the app's price rule enforceable.
    -- src/types/marketplace.ts:28 documents:
    --   "price: number;  // Required for 'buy'/'both', can be 0 for 'trade'"
    -- Previously the schema could not express this because transaction_type
    -- did not exist on the table.
    ALTER TABLE listings ADD CONSTRAINT chk_listing_price_required
      CHECK (
        (transaction_type IN ('buy', 'both') AND price > 0)
        OR transaction_type = 'trade'
      );

    -- Type-specific offer requirements
    ALTER TABLE structured_offers ADD CONSTRAINT chk_purchase_has_price
      CHECK ((offer_type = 'purchase' AND offered_price IS NOT NULL) OR offer_type != 'purchase');

    ALTER TABLE structured_offers ADD CONSTRAINT chk_trade_has_item
      CHECK ((offer_type = 'trade' AND offered_item_id IS NOT NULL) OR offer_type != 'trade');

    ALTER TABLE structured_offers ADD CONSTRAINT chk_commission_has_scope
      CHECK ((offer_type = 'commission' AND commission_scope IS NOT NULL
                             AND commission_timeline_days IS NOT NULL)
             OR offer_type != 'commission');
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS portfolio_photos;
    DROP TABLE IF EXISTS transaction_milestones;
    DROP TABLE IF EXISTS chat_messages;
    DROP TABLE IF EXISTS chat_threads;
    DROP TABLE IF EXISTS structured_offers;
    DROP TABLE IF EXISTS listings;
  `);
};

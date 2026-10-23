/**
 * Migration 023: Marketplace Inventory on Server
 *
 * Extends owned_attire for marketplace usage without touching trades system.
 * - client_id: unique per owner for import mapping (mobile uses 'attr-timestamp')
 * - version: optimistic locking for concurrent edits
 * - original_project_ref: stores mobile project IDs during import (FK can't resolve them)
 * - inventory_item_history: separate provenance tracking for marketplace (not trades)
 *
 * Item eligibility for marketplace:
 *   availability_status = 'free' AND reserved_trade_id IS NULL AND not on active listing
 *
 * Listed state is derived: listings.inventory_item_id with listing_status='active'
 * enforced by partial unique index (one active listing per item).
 *
 * Does NOT modify: migration 021 columns (slot, reserved_trade_id), trades tables,
 * item_ownership_history (trades-only).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- Extend owned_attire for marketplace
    ALTER TABLE owned_attire
      ADD COLUMN client_id VARCHAR(100) NULL,
      ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
      ADD COLUMN original_project_ref TEXT NULL;

    -- Unique constraint: (user_id, client_id) for import deduplication
    -- Partial index: only where client_id is not null (server-created items have no client_id)
    CREATE UNIQUE INDEX idx_owned_attire_user_client_id 
      ON owned_attire(user_id, client_id) 
      WHERE client_id IS NOT NULL;

    CREATE INDEX idx_owned_attire_version ON owned_attire(version);

    COMMENT ON COLUMN owned_attire.client_id IS
      'Mobile-generated ID (e.g., "attr-1730000000000"). Unique per owner. '
      'Used for import deduplication. NULL for server-created items (from purchases/trades).';

    COMMENT ON COLUMN owned_attire.version IS
      'Optimistic locking counter. Incremented on every update. '
      'Client must send current version; mismatch returns 409 conflict.';

    COMMENT ON COLUMN owned_attire.original_project_ref IS
      'Mobile project ID stored during import when committed_to_project_id FK cannot resolve. '
      'Format: "proj-123". NULL for items never committed or created on server. '
      'Future migration can restore links when projects move to server.';

    -- Inventory transfer history (separate from item_ownership_history used by trades)
    CREATE TABLE inventory_item_history (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id          UUID NOT NULL REFERENCES owned_attire(attire_id) ON DELETE CASCADE,
      from_user_id     UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      to_user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      reason           VARCHAR(20) NOT NULL
                       CHECK (reason IN ('created', 'sale', 'trade', 'commission')),
      listing_id       UUID NULL REFERENCES listings(listing_id) ON DELETE SET NULL,
      offer_id         UUID NULL REFERENCES structured_offers(offer_id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_inventory_item_history_item_id ON inventory_item_history(item_id);
    CREATE INDEX idx_inventory_item_history_from_user ON inventory_item_history(from_user_id)
      WHERE from_user_id IS NOT NULL;
    CREATE INDEX idx_inventory_item_history_to_user ON inventory_item_history(to_user_id);
    CREATE INDEX idx_inventory_item_history_listing ON inventory_item_history(listing_id)
      WHERE listing_id IS NOT NULL;
    CREATE INDEX idx_inventory_item_history_offer ON inventory_item_history(offer_id)
      WHERE offer_id IS NOT NULL;
    CREATE INDEX idx_inventory_item_history_created_at ON inventory_item_history(created_at DESC);

    COMMENT ON TABLE inventory_item_history IS
      'Marketplace item transfer log (separate from item_ownership_history for trades). '
      'from_user_id NULL = item creation. Reason: created (new item entry), sale (purchase accepted), '
      'trade (trade offer accepted), commission (commission accepted). '
      'listing_id/offer_id link to the marketplace transaction that caused the transfer.';

    COMMENT ON COLUMN inventory_item_history.reason IS
      'Transfer reason: created (initial entry or import), sale (purchase offer accepted), '
      'trade (trade offer accepted on marketplace), commission (commission completed).';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS inventory_item_history;

    DROP INDEX IF EXISTS idx_owned_attire_user_client_id;
    DROP INDEX IF EXISTS idx_owned_attire_version;

    ALTER TABLE owned_attire
      DROP COLUMN IF EXISTS client_id,
      DROP COLUMN IF EXISTS version,
      DROP COLUMN IF EXISTS original_project_ref;
  `);
};

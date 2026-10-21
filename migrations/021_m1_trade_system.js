/**
 * Migration 021: M1 Trade System
 *
 * Implements server-side item ownership and trade state machine:
 * - app_settings: database-driven configuration (no hard-coded limits)
 * - Extends owned_attire with trade reservation support
 * - item_ownership_history: tracks every item transfer
 * - trades: state machine for user-to-user trades (swap/sale)
 * - trade_items: many-to-many junction for items in a trade
 * - trade_events: audit trail for every state transition
 *
 * Design decisions:
 * - Reuses existing owned_attire table (no duplicate inventory_items table)
 * - All tunables stored in app_settings (Holder-editable, no code changes needed)
 * - Trades are user-to-user (NOT listing-centric like structured_offers)
 * - Both parties must confirm physical handoff before items move
 * - System automatically expires stale trades and releases reservations
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    -- =======================================================================
    -- 1. APP_SETTINGS (database-driven configuration)
    -- =======================================================================
    CREATE TABLE app_settings (
      key               TEXT PRIMARY KEY,
      value             JSONB NOT NULL,
      value_type        TEXT NOT NULL
                        CHECK (value_type IN ('number', 'string', 'boolean', 'array', 'object')),
      description       TEXT NOT NULL,
      min_value         NUMERIC NULL,
      max_value         NUMERIC NULL,
      version           INTEGER NOT NULL DEFAULT 1,
      updated_by        UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_app_settings_updated_at ON app_settings(updated_at DESC);

    COMMENT ON TABLE app_settings IS
      'System-wide configuration. All limits, timeouts, and allowed types are stored here. '
      'Holder can edit via /admin/settings endpoints. No tunable value may live in source code.';

    -- =======================================================================
    -- 2. EXTEND OWNED_ATTIRE (add trade reservation support)
    -- =======================================================================
    ALTER TABLE owned_attire
      ADD COLUMN slot VARCHAR(50) NULL,
      ADD COLUMN reserved_trade_id UUID NULL;

    -- Extend availability_status enum to include 'reserved'
    ALTER TABLE owned_attire DROP CONSTRAINT IF EXISTS owned_attire_availability_status_check;
    ALTER TABLE owned_attire ADD CONSTRAINT owned_attire_availability_status_check
      CHECK (availability_status IN ('free', 'committed', 'reserved'));

    CREATE INDEX idx_owned_attire_reserved_trade ON owned_attire(reserved_trade_id)
      WHERE reserved_trade_id IS NOT NULL;

    COMMENT ON COLUMN owned_attire.slot IS
      'Garment slot (e.g., "wig", "top", "bottom", "shoes"). Used for trade matching.';
    COMMENT ON COLUMN owned_attire.reserved_trade_id IS
      'FK to trades.id. Set when item is reserved in an accepted trade. '
      'Prevents item from being offered in multiple trades simultaneously.';

    -- =======================================================================
    -- 3. ITEM_OWNERSHIP_HISTORY (audit trail for transfers)
    -- =======================================================================
    CREATE TABLE item_ownership_history (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_id          UUID NOT NULL REFERENCES owned_attire(attire_id) ON DELETE CASCADE,
      from_user_id     UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      to_user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      trade_id         UUID NULL,
      transferred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_item_ownership_history_item_id ON item_ownership_history(item_id);
    CREATE INDEX idx_item_ownership_history_from_user ON item_ownership_history(from_user_id);
    CREATE INDEX idx_item_ownership_history_to_user ON item_ownership_history(to_user_id);
    CREATE INDEX idx_item_ownership_history_trade_id ON item_ownership_history(trade_id)
      WHERE trade_id IS NOT NULL;
    CREATE INDEX idx_item_ownership_history_date ON item_ownership_history(transferred_at DESC);

    COMMENT ON TABLE item_ownership_history IS
      'Immutable log of every item transfer. from_user_id is NULL for initial acquisition. '
      'trade_id links to the trade that caused this transfer (NULL for manual transfers).';

    -- =======================================================================
    -- 4. TRADES (user-to-user trade state machine)
    -- =======================================================================
    CREATE TABLE trades (
      id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id               UUID NULL REFERENCES listings(listing_id) ON DELETE SET NULL,
      proposer_id              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      recipient_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      type                     VARCHAR(10) NOT NULL
                               CHECK (type IN ('swap', 'sale')),
      state                    VARCHAR(20) NOT NULL DEFAULT 'proposed'
                               CHECK (state IN ('proposed', 'accepted', 'completed',
                                                'declined', 'cancelled', 'expired')),
      proposer_confirmed_at    TIMESTAMPTZ NULL,
      recipient_confirmed_at   TIMESTAMPTZ NULL,
      accepted_at              TIMESTAMPTZ NULL,
      expires_at               TIMESTAMPTZ NOT NULL,
      note                     TEXT NULL,
      version                  INTEGER NOT NULL DEFAULT 1,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      CONSTRAINT chk_trades_different_users CHECK (proposer_id <> recipient_id)
    );

    CREATE INDEX idx_trades_proposer ON trades(proposer_id);
    CREATE INDEX idx_trades_recipient ON trades(recipient_id);
    CREATE INDEX idx_trades_state ON trades(state);
    CREATE INDEX idx_trades_expires_at ON trades(expires_at)
      WHERE state IN ('proposed', 'accepted');
    CREATE INDEX idx_trades_created_at ON trades(created_at DESC);

    COMMENT ON TABLE trades IS
      'User-to-user trades (swap or sale). NOT listing-centric. '
      'State machine enforces: propose → accept → both confirm → complete. '
      'Items only move after BOTH parties confirm physical handoff.';

    -- =======================================================================
    -- 5. TRADE_ITEMS (many-to-many: items involved in a trade)
    -- =======================================================================
    CREATE TABLE trade_items (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_id      UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      item_id       UUID NOT NULL REFERENCES owned_attire(attire_id) ON DELETE CASCADE,
      from_user_id  UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      to_user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,

      CONSTRAINT uq_trade_items_trade_item UNIQUE (trade_id, item_id)
    );

    CREATE INDEX idx_trade_items_trade_id ON trade_items(trade_id);
    CREATE INDEX idx_trade_items_item_id ON trade_items(item_id);
    CREATE INDEX idx_trade_items_from_user ON trade_items(from_user_id);
    CREATE INDEX idx_trade_items_to_user ON trade_items(to_user_id);

    COMMENT ON TABLE trade_items IS
      'Items included in a trade. Each row represents one item moving from from_user_id to to_user_id. '
      'For swap: items from both sides. For sale: items from one side only.';

    -- =======================================================================
    -- 6. TRADE_EVENTS (audit trail for state transitions)
    -- =======================================================================
    CREATE TABLE trade_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      trade_id    UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
      actor_id    UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      from_state  VARCHAR(20) NULL,
      to_state    VARCHAR(20) NOT NULL,
      note        TEXT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_trade_events_trade_id ON trade_events(trade_id, created_at DESC);
    CREATE INDEX idx_trade_events_actor ON trade_events(actor_id) WHERE actor_id IS NOT NULL;

    COMMENT ON TABLE trade_events IS
      'Immutable log of every trade state change. actor_id is NULL for system-triggered transitions (expiry). '
      'Also written to audit_events table for cross-entity audit trail.';

    -- Add FK from owned_attire.reserved_trade_id to trades.id
    -- (deferred until after trades table exists)
    ALTER TABLE owned_attire
      ADD CONSTRAINT fk_owned_attire_reserved_trade
        FOREIGN KEY (reserved_trade_id) REFERENCES trades(id) ON DELETE SET NULL;

    -- =======================================================================
    -- SEED: Default trade settings
    -- =======================================================================
    INSERT INTO app_settings (key, value, value_type, description, min_value, max_value) VALUES
      ('trade.offer_expiry_hours', '72', 'number',
       'Hours before a proposed trade expires if not accepted', 1, 720),

      ('trade.confirm_window_hours', '48', 'number',
       'Hours after acceptance for both parties to confirm physical handoff', 1, 168),

      ('trade.max_items_per_side', '5', 'number',
       'Maximum items one party can offer in a single trade', 1, 20),

      ('trade.max_active_trades_per_user', '10', 'number',
       'Maximum concurrent active trades (proposed or accepted) per user', 1, 50),

      ('trade.allowed_types', '["swap","sale"]', 'array',
       'Trade types permitted on the platform (JSON array of strings)', NULL, NULL),

      ('trade.reminder_hours_before_expiry', '12', 'number',
       'Hours before expiry to send reminder notifications', 1, 72),

      ('trade.expiry_sweep_minutes', '5', 'number',
       'Interval in minutes for system to check and expire stale trades', 1, 60),

      ('settings.cache_seconds', '30', 'number',
       'TTL in seconds for settings cache (controls how fast changes propagate)', 5, 600);

    COMMENT ON COLUMN app_settings.key IS
      'Unique setting identifier. Namespace convention: entity.setting_name (e.g., trade.max_items_per_side).';
    COMMENT ON COLUMN app_settings.value IS
      'JSON value. Number stored as string to preserve precision. Access via CAST or application parsing.';
    COMMENT ON COLUMN app_settings.min_value IS
      'Minimum allowed value (for numeric settings). Validated on update. NULL if not applicable.';
    COMMENT ON COLUMN app_settings.max_value IS
      'Maximum allowed value (for numeric settings). Validated on update. NULL if not applicable.';
    COMMENT ON COLUMN app_settings.version IS
      'Incremented on every update. Enables optimistic locking for admin UI.';
    COMMENT ON COLUMN app_settings.updated_by IS
      'User ID of the Holder who last modified this setting. NULL for seed defaults.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Drop in reverse order to avoid FK violations
    DROP TABLE IF EXISTS trade_events;
    DROP TABLE IF EXISTS trade_items;
    DROP TABLE IF EXISTS trades;
    DROP TABLE IF EXISTS item_ownership_history;

    -- Revert owned_attire changes
    ALTER TABLE owned_attire
      DROP CONSTRAINT IF EXISTS fk_owned_attire_reserved_trade,
      DROP CONSTRAINT IF EXISTS owned_attire_availability_status_check,
      DROP COLUMN IF EXISTS reserved_trade_id,
      DROP COLUMN IF EXISTS slot;

    -- Restore original availability_status constraint
    ALTER TABLE owned_attire ADD CONSTRAINT owned_attire_availability_status_check
      CHECK (availability_status IN ('free', 'committed'));

    DROP TABLE IF EXISTS app_settings;
  `);
};


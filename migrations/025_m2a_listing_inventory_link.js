/**
 * Migration 025: M2a Listing-Inventory Link
 *
 * Fixes and extends marketplace-inventory integration:
 * 1. Fix defective uq_listings_item_id_active (missing WHERE clause from migration 023)
 * 2. Change listings.item_id FK from ON DELETE SET NULL to ON DELETE RESTRICT
 * 3. Create versioned settings table for Holder-editable marketplace rules
 * 4. Seed marketplace settings: tradable_item_statuses, max_active_listings_per_item, 
 *    nontradable_reason_messages
 *
 * Design: "listed" status is DERIVED from active listing existence, not stored.
 * "reserved" status added for M2b (not used yet).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // 1. Fix defective partial unique index
  // Migration 023 created it but node-pg-migrate lost the WHERE clause
  pgm.sql(`
    DROP INDEX IF EXISTS uq_listings_item_id_active;
    
    CREATE UNIQUE INDEX uq_listings_item_id_active 
    ON listings (item_id)
    WHERE listing_status = 'active' AND item_id IS NOT NULL;
    
    COMMENT ON INDEX uq_listings_item_id_active IS
      'Partial unique index: one active listing per inventory item. '
      'NULL item_id values (commission listings) are excluded from uniqueness.';
  `);

  // 2. Change FK constraint from SET NULL to RESTRICT
  // Prevents deletion of items that have listings (even cancelled/sold ones)
  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS listings_item_id_fkey,
      ADD CONSTRAINT listings_item_id_fkey
        FOREIGN KEY (item_id) 
        REFERENCES owned_attire(attire_id) 
        ON DELETE RESTRICT;
    
    COMMENT ON CONSTRAINT listings_item_id_fkey ON listings IS
      'ON DELETE RESTRICT: items with any listings (active/sold/cancelled) cannot be deleted. '
      'This preserves listing history and prevents dangling references.';
  `);

  // 3. Create versioned settings table
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key           VARCHAR(100) PRIMARY KEY,
      value         JSONB NOT NULL,
      scope         VARCHAR(50) NOT NULL DEFAULT 'global'
                    CHECK (scope IN ('global', 'marketplace', 'trades', 'events')),
      version       INTEGER NOT NULL DEFAULT 1,
      updated_by    UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_app_settings_scope ON app_settings(scope);
    CREATE INDEX idx_app_settings_updated_by ON app_settings(updated_by) 
      WHERE updated_by IS NOT NULL;

    COMMENT ON TABLE app_settings IS
      'Versioned settings for Holder-editable marketplace rules. '
      'Changes are audit-logged in audit_events. Never hard-code tunable values.';

    COMMENT ON COLUMN app_settings.version IS
      'Incremented on every update for optimistic locking and change tracking.';
  `);

  // 4. Seed marketplace settings
  pgm.sql(`
    INSERT INTO app_settings (key, value, scope, version, created_at, updated_at)
    VALUES 
      -- Which availability_status values make an item tradable
      ('tradable_item_statuses', '["free"]'::jsonb, 'marketplace', 1, NOW(), NOW()),
      
      -- How many active listings can reference the same item_id
      ('max_active_listings_per_item', '1'::jsonb, 'marketplace', 1, NOW(), NOW()),
      
      -- User-facing reason messages per item status
      ('nontradable_reason_messages', '{
        "committed": "This item is committed to a project",
        "reserved": "This item is reserved for a trade",
        "listed": "This item is already listed"
      }'::jsonb, 'marketplace', 1, NOW(), NOW())
    ON CONFLICT (key) DO NOTHING;
  `);

  // 5. Add "reserved" status to owned_attire for M2b (not used yet)
  // Check if constraint exists before trying to drop it
  pgm.sql(`
    DO $$ 
    BEGIN
      -- Drop old constraint if it exists
      IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'owned_attire_availability_status_check'
      ) THEN
        ALTER TABLE owned_attire DROP CONSTRAINT owned_attire_availability_status_check;
      END IF;
      
      -- Add new constraint with reserved
      ALTER TABLE owned_attire
        ADD CONSTRAINT owned_attire_availability_status_check
        CHECK (availability_status IN ('free', 'committed', 'reserved'));
    END $$;
    
    COMMENT ON COLUMN owned_attire.availability_status IS
      'Item availability: free (tradable), committed (project-locked), reserved (trade-locked for M2b). '
      'Listed status is DERIVED from active listing existence, not stored here.';
  `);
};

exports.down = (pgm) => {
  // Revert reserved status
  pgm.sql(`
    ALTER TABLE owned_attire
      DROP CONSTRAINT IF EXISTS owned_attire_availability_status_check,
      ADD CONSTRAINT owned_attire_availability_status_check
        CHECK (availability_status IN ('free', 'committed'));
  `);

  // Drop settings table
  pgm.sql(`DROP TABLE IF EXISTS app_settings;`);

  // Revert FK to SET NULL
  pgm.sql(`
    ALTER TABLE listings
      DROP CONSTRAINT IF EXISTS listings_item_id_fkey,
      ADD CONSTRAINT listings_item_id_fkey
        FOREIGN KEY (item_id) 
        REFERENCES owned_attire(attire_id) 
        ON DELETE SET NULL;
  `);

  // Revert to defective index (as it was in migration 023's result)
  pgm.sql(`
    DROP INDEX IF EXISTS uq_listings_item_id_active;
    
    CREATE UNIQUE INDEX uq_listings_item_id_active 
    ON listings (item_id);
  `);
};

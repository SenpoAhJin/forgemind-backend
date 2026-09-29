/**
 * Domain 5: Owned Attire + Condition History
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 5: OWNED ATTIRE + CONDITION HISTORY"
 * Tables: owned_attire, attire_usage_history  (2)
 *
 * ORDERING NOTE — deferred foreign key:
 *   owned_attire.committed_to_project_id  and  attire_usage_history.project_id
 *   both reference projects(event-less), which is created in Domain 6, i.e. AFTER
 *   this migration. To keep the doc's domain split intact (one migration per
 *   domain, as required) the columns are created here and the FK constraints are
 *   added as ALTER TABLE at the end of migration 006.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE owned_attire (
      attire_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      entry_method              VARCHAR(10) NOT NULL
                                CHECK (entry_method IN ('photo', 'text', 'voice')),
      entry_language            VARCHAR(10) NULL
                                CHECK (entry_language IN ('english', 'taglish')),
      original_input_text       TEXT NULL,
      photo_urls                JSONB NULL,
      auto_categorized_type     VARCHAR(30) NOT NULL
                                CHECK (auto_categorized_type IN
                                       ('wig', 'clothing', 'footwear', 'accessory', 'armor',
                                        'weapon', 'prop', 'fabric', 'material', 'other')),
      auto_categorized_color    VARCHAR(100) NULL,
      auto_categorized_style    VARCHAR(200) NULL,
      flexibility_tag           VARCHAR(20) NOT NULL
                                CHECK (flexibility_tag IN
                                       ('restyle-willing', 'dye-willing', 'as-is-only')),
      condition_rating          INTEGER NOT NULL
                                CHECK (condition_rating >= 1 AND condition_rating <= 5),
      condition_photo_history   JSONB NULL,
      availability_status       VARCHAR(20) NOT NULL DEFAULT 'free'
                                CHECK (availability_status IN ('free', 'committed')),
      committed_to_project_id   UUID NULL,
      acquired_date             DATE NULL,
      acquisition_cost          NUMERIC(12,2) NULL,
      notes                     TEXT NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE attire_usage_history (
      usage_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      attire_id     UUID NOT NULL REFERENCES owned_attire(attire_id) ON DELETE CASCADE,
      project_id    UUID NOT NULL,
      variant_id    UUID NOT NULL REFERENCES variants(variant_id) ON DELETE CASCADE,
      used_date     DATE NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_owned_attire_user_id ON owned_attire(user_id);
    CREATE INDEX idx_owned_attire_availability ON owned_attire(availability_status);
    CREATE INDEX idx_owned_attire_type ON owned_attire(auto_categorized_type);

    CREATE INDEX idx_attire_usage_history_attire_id ON attire_usage_history(attire_id);
    CREATE INDEX idx_attire_usage_history_project_id ON attire_usage_history(project_id);
    CREATE INDEX idx_attire_usage_history_variant_id ON attire_usage_history(variant_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS attire_usage_history;
    DROP TABLE IF EXISTS owned_attire;
  `);
};

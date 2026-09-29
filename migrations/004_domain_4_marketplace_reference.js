/**
 * Domain 4: Marketplace Reference Data
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 4: MARKETPLACE REFERENCE DATA"
 * Tables: permitted_categories, value_references  (2)
 *
 * Schema decisions honoured:
 *  - permitted_categories is the classification target list for the Phase 4
 *    listing screener (see docs/ai/LISTING_SCREENER_AI_PLAN.md).
 *  - edge_case_notes exists specifically to record prop-vs-real ambiguities.
 *  - All money is NUMERIC(12,2) — never float.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE permitted_categories (
      category_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category_name      VARCHAR(100) NOT NULL UNIQUE,
      description        TEXT NOT NULL,
      examples           JSONB NOT NULL,
      edge_case_notes    TEXT NULL,
      is_active          BOOLEAN NOT NULL DEFAULT true,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE value_references (
      value_reference_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      item_category             VARCHAR(200) NOT NULL,
      material_category         VARCHAR(200) NULL,
      typical_price_min         NUMERIC(12,2) NOT NULL,
      typical_price_max         NUMERIC(12,2) NOT NULL,
      sample_count              INTEGER NOT NULL,
      aggregation_window_start  DATE NOT NULL,
      aggregation_window_end    DATE NOT NULL,
      last_updated              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX idx_permitted_categories_name
      ON permitted_categories(category_name);
    CREATE INDEX idx_permitted_categories_active
      ON permitted_categories(is_active) WHERE is_active = true;

    CREATE INDEX idx_value_references_item_category
      ON value_references(item_category);
    CREATE INDEX idx_value_references_material_category
      ON value_references(material_category);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS value_references;
    DROP TABLE IF EXISTS permitted_categories;
  `);
};

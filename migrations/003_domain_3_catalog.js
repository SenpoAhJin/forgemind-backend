/**
 * Domain 3: Catalog (Characters, Variants, Components)
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 3: CATALOG"
 * Tables: characters, variants, components, variant_components  (4)
 *
 * Schema decisions honoured:
 *  - slug columns on characters/variants for stable seed references.
 *  - origin_tag carries the canon / fan-art-inspired / user-original distinction
 *    that ForgeMind.docx requires the variant library to preserve.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE characters (
      character_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug                  VARCHAR(200) NOT NULL UNIQUE,
      character_name        VARCHAR(200) NOT NULL,
      source_media          VARCHAR(200) NOT NULL,
      media_type            VARCHAR(20) NOT NULL
                            CHECK (media_type IN
                                   ('anime', 'manga', 'game', 'movie', 'original', 'other')),
      description           TEXT NULL,
      reference_image_url   VARCHAR(500) NULL,
      created_by_user_id    UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      is_confirmed          BOOLEAN NOT NULL DEFAULT false,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE variants (
      variant_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug                    VARCHAR(200) NOT NULL UNIQUE,
      character_id            UUID NOT NULL REFERENCES characters(character_id) ON DELETE CASCADE,
      variant_name            VARCHAR(200) NOT NULL,
      origin_tag              VARCHAR(30) NOT NULL
                              CHECK (origin_tag IN ('canon', 'fan-art-inspired', 'user-original')),
      origin_description      TEXT NULL,
      build_difficulty_rating INTEGER NULL
                              CHECK (build_difficulty_rating >= 1 AND build_difficulty_rating <= 5),
      reference_image_urls    JSONB NULL,
      status                  VARCHAR(20) NOT NULL DEFAULT 'candidate'
                              CHECK (status IN ('confirmed', 'candidate')),
      candidate_source        VARCHAR(20) NULL
                              CHECK (candidate_source IN ('ai-flagged', 'user-submitted')),
      confirmed_by_user_id    UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      confirmed_at            TIMESTAMPTZ NULL,
      created_by_user_id      UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE components (
      component_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      component_type   VARCHAR(30) NOT NULL
                       CHECK (component_type IN
                              ('wig', 'top', 'bottom', 'shoes', 'accessory', 'armor',
                               'weapon', 'prop', 'makeup', 'other')),
      component_name   VARCHAR(200) NOT NULL,
      description      TEXT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE variant_components (
      variant_component_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      variant_id             UUID NOT NULL REFERENCES variants(variant_id) ON DELETE CASCADE,
      component_id           UUID NOT NULL REFERENCES components(component_id) ON DELETE CASCADE,
      is_defining_feature    BOOLEAN NOT NULL DEFAULT false,
      typical_materials      JSONB NULL,
      color_requirements     VARCHAR(100) NULL,
      notes                  TEXT NULL
    );

    CREATE UNIQUE INDEX idx_characters_slug ON characters(slug);
    CREATE INDEX idx_characters_confirmed ON characters(is_confirmed);
    CREATE INDEX idx_characters_source_media ON characters(source_media);

    CREATE UNIQUE INDEX idx_variants_slug ON variants(slug);
    CREATE INDEX idx_variants_character_id ON variants(character_id);
    CREATE INDEX idx_variants_status ON variants(status);
    CREATE INDEX idx_variants_origin_tag ON variants(origin_tag);

    CREATE INDEX idx_components_type ON components(component_type);

    CREATE INDEX idx_variant_components_variant_id ON variant_components(variant_id);
    CREATE INDEX idx_variant_components_component_id ON variant_components(component_id);
    CREATE INDEX idx_variant_components_defining
      ON variant_components(is_defining_feature) WHERE is_defining_feature = true;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS variant_components;
    DROP TABLE IF EXISTS components;
    DROP TABLE IF EXISTS variants;
    DROP TABLE IF EXISTS characters;
  `);
};

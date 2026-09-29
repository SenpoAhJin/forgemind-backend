/**
 * Domain 2: Holder Verification
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 2: HOLDER VERIFICATION"
 * Tables: holder_verification_records, user_marketplace_participant_types  (2)
 *
 * Schema decisions honoured:
 *  - Defect #11: ID proof split into id_front_image_ref + id_back_image_ref.
 *  - Defect #13: reviewed_by_holder_id is NULLable so ON DELETE SET NULL is legal.
 *  - ID image columns store REFERENCES only; images live in encrypted object storage.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE holder_verification_records (
      verification_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      id_front_image_ref        VARCHAR(500) NOT NULL,
      id_back_image_ref         VARCHAR(500) NOT NULL,
      registered_name           VARCHAR(200) NOT NULL,
      recent_photo_url          VARCHAR(500) NOT NULL,
      year_on_id                INTEGER NULL,
      participant_types         TEXT[] NULL,
      verification_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (verification_status IN ('pending', 'approved', 'rejected')),
      submission_timestamp      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_by_holder_id     UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      review_timestamp          TIMESTAMPTZ NULL,
      rejection_reason          TEXT NULL,
      notes                     TEXT NULL
    );

    CREATE TABLE user_marketplace_participant_types (
      participant_type_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      participant_type          VARCHAR(30) NOT NULL
                                CHECK (participant_type IN
                                       ('buyer', 'seller_individual', 'commissioner', 'rental_shop')),
      verification_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (verification_status IN
                                       ('pending', 'verified', 'rejected', 'revoked')),
      submitted_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      verified_at               TIMESTAMPTZ NULL,
      verified_by_holder_id     UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      rejection_reason          TEXT NULL
    );

    CREATE INDEX idx_holder_verification_user_id
      ON holder_verification_records(user_id);
    CREATE INDEX idx_holder_verification_status
      ON holder_verification_records(verification_status);

    CREATE INDEX idx_user_marketplace_participant_types_user_id
      ON user_marketplace_participant_types(user_id);
    CREATE UNIQUE INDEX idx_unique_user_participant_type
      ON user_marketplace_participant_types(user_id, participant_type);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS user_marketplace_participant_types;
    DROP TABLE IF EXISTS holder_verification_records;
  `);
};

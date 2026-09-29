/**
 * Domain 1: Identity / Authentication
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 1: IDENTITY / AUTHENTICATION"
 * Tables: users, sessions, email_otp_requests  (3)
 *
 * Schema decisions honoured:
 *  - gen_random_uuid() is built into PostgreSQL 13+. No uuid-ossp extension (no CREATE EXTENSION).
 *  - All CHECK constraints carry the CORRECTED enum values (defect #1, #2).
 *  - No FK is both NOT NULL and ON DELETE SET NULL (defect #13).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE users (
      user_id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email                            VARCHAR(255) NOT NULL UNIQUE,
      password_hash                    VARCHAR(255) NOT NULL,
      display_name                     VARCHAR(100) NOT NULL,
      is_cosplayer                     BOOLEAN NOT NULL DEFAULT false,
      is_organizer                     BOOLEAN NOT NULL DEFAULT false,
      base_body_selection              VARCHAR(20) NOT NULL
                                        CHECK (base_body_selection IN ('male', 'female')),
      profile_photo_url                VARCHAR(500) NULL,
      is_holder_verified               BOOLEAN NOT NULL DEFAULT false,
      verification_status              VARCHAR(20) NOT NULL DEFAULT 'not_submitted'
                                        CHECK (verification_status IN
                                               ('not_submitted', 'pending', 'verified', 'rejected', 'revoked')),
      organizer_role                   VARCHAR(10) NULL
                                        CHECK (organizer_role IN ('head', 'staff')),
      head_organizer_department        VARCHAR(50) NULL
                                        CHECK (head_organizer_department IN
                                               ('logistics', 'programs', 'sponsorship', 'secretariat',
                                                'technical_production', 'marketing')),
      department                       VARCHAR(50) NULL
                                        CHECK (department IN
                                               ('logistics', 'programs', 'sponsorship', 'secretariat',
                                                'technical_production', 'marketing')),
      department_verification_status   VARCHAR(20) NULL
                                        CHECK (department_verification_status IN
                                               ('pending', 'approved', 'rejected')),
      department_rejection_reason      TEXT NULL,
      marketplace_role                 VARCHAR(10) NULL
                                        CHECK (marketplace_role IN ('buyer', 'seller', 'both')),
      seller_display_name              VARCHAR(100) NULL,
      marketplace_contact_email        VARCHAR(255) NULL,
      marketplace_contact_phone        VARCHAR(50) NULL,
      payout_method_label              VARCHAR(100) NULL,
      payout_method_number             VARCHAR(255) NULL,
      agreed_to_marketplace_terms      BOOLEAN NULL,
      marketplace_submitted_at         TIMESTAMPTZ NULL,
      marketplace_rejection_reason     TEXT NULL,
      data_consent_given               BOOLEAN NOT NULL DEFAULT false,
      theme_preference                 VARCHAR(10) NOT NULL DEFAULT 'purple'
                                        CHECK (theme_preference IN
                                               ('purple', 'blue', 'pink', 'green', 'orange')),
      created_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE sessions (
      session_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id              UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      refresh_token_hash   VARCHAR(64) NOT NULL UNIQUE,
      device_info          JSONB NULL,
      ip_address           INET NULL,
      expires_at           TIMESTAMPTZ NOT NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_accessed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE email_otp_requests (
      request_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email                VARCHAR(255) NOT NULL,
      otp_hash             VARCHAR(255) NOT NULL,
      purpose              VARCHAR(20) NOT NULL
                           CHECK (purpose IN ('email_verification', 'password_reset')),
      expires_at           TIMESTAMPTZ NOT NULL,
      attempts_remaining   INTEGER NOT NULL DEFAULT 3,
      used_at              TIMESTAMPTZ NULL,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_users_organizer_role ON users(organizer_role) WHERE organizer_role IS NOT NULL;
    CREATE INDEX idx_users_verification_status ON users(verification_status);
    CREATE INDEX idx_users_marketplace_role ON users(marketplace_role) WHERE marketplace_role IS NOT NULL;

    CREATE INDEX idx_sessions_user_id ON sessions(user_id);
    CREATE UNIQUE INDEX idx_sessions_refresh_token_hash ON sessions(refresh_token_hash);
    CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

    CREATE INDEX idx_email_otp_email ON email_otp_requests(email);
    CREATE INDEX idx_email_otp_expires_at ON email_otp_requests(expires_at);

    -- Cross-column constraints
    ALTER TABLE users ADD CONSTRAINT chk_head_has_department
      CHECK (
        (organizer_role = 'head' AND head_organizer_department IS NOT NULL)
        OR organizer_role != 'head'
        OR organizer_role IS NULL
      );

    ALTER TABLE users ADD CONSTRAINT chk_staff_has_department
      CHECK (
        (organizer_role = 'staff' AND department IS NOT NULL
         AND department_verification_status IS NOT NULL)
        OR organizer_role != 'staff'
        OR organizer_role IS NULL
      );

    ALTER TABLE users ADD CONSTRAINT chk_seller_has_details
      CHECK (
        (marketplace_role IN ('seller', 'both')
         AND seller_display_name IS NOT NULL
         AND payout_method_label IS NOT NULL
         AND payout_method_number IS NOT NULL)
        OR marketplace_role = 'buyer'
        OR marketplace_role IS NULL
      );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS email_otp_requests;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
  `);
};

/**
 * Domain 10: Extras & Cross-Cutting
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 10: EXTRAS & CROSS-CUTTING"
 * Tables: diary_entries, live_location_sessions, audit_events, user_notification_state  (4)
 *
 * Schema decisions honoured:
 *  - Defect #12: audit_events uses audit_event_id as its column name.
 *  - Defect #9:  diary_entries allows empty entry_text for photo-only entries.
 *  - Defect #8:  no hard delete of user account — soft deactivate via users.is_active
 *    equivalent; audit_events.actor_user_id is NULLable + ON DELETE SET NULL so the
 *    audit trail survives account deletion.
 *  - Defect #13: every FK here is either NOT NULL + CASCADE, or NULLable + SET NULL.
 *    No NOT NULL FK with ON DELETE SET NULL anywhere.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE diary_entries (
      entry_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      project_id    UUID NULL REFERENCES projects(project_id) ON DELETE SET NULL,
      event_id      UUID NULL REFERENCES events(event_id) ON DELETE SET NULL,
      entry_date    DATE NOT NULL,
      -- Defect #9: photo-only entries are legal, so entry_text is NULLable.
      entry_text    TEXT NULL,
      photo_urls    JSONB NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE live_location_sessions (
      session_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id           UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      event_id          UUID NULL REFERENCES events(event_id) ON DELETE CASCADE,
      project_id        UUID NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      last_location     VARCHAR(50) NOT NULL,
      last_accuracy     NUMERIC(7,2) NULL,
      is_visible        BOOLEAN NOT NULL DEFAULT true,
      started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Defect #12: column is audit_event_id, NOT event_id.
    CREATE TABLE audit_events (
      audit_event_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_user_id   UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      -- audit_event_id already names the audit row; the audited entity is tracked
      -- in entity_type/entity_id rather than a confusingly named event_id column.
      entity_type     VARCHAR(50) NOT NULL,
      entity_id       UUID NULL,
      action          VARCHAR(20) NOT NULL
                      CHECK (action IN ('create', 'update', 'delete', 'access', 'export', 'verify')),
      details         JSONB NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE user_notification_state (
      user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      is_chat_muted         BOOLEAN NOT NULL DEFAULT false,
      is_marketplace_muted  BOOLEAN NOT NULL DEFAULT false,
      is_logistics_muted    BOOLEAN NOT NULL DEFAULT false,
      is_projects_muted     BOOLEAN NOT NULL DEFAULT false,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT pk_user_notification_state PRIMARY KEY (user_id)
    );

    CREATE INDEX idx_diary_entries_user_id ON diary_entries(user_id);
    CREATE INDEX idx_diary_entries_date ON diary_entries(entry_date);
    CREATE INDEX idx_diary_entries_user_date ON diary_entries(user_id, entry_date DESC);

    CREATE INDEX idx_live_location_sessions_user_id ON live_location_sessions(user_id);
    CREATE INDEX idx_live_location_sessions_event_id ON live_location_sessions(event_id);
    CREATE INDEX idx_live_location_sessions_active
      ON live_location_sessions(is_visible, last_updated_at DESC) WHERE is_visible = true;

    CREATE INDEX idx_audit_events_actor_user_id ON audit_events(actor_user_id);
    CREATE INDEX idx_audit_events_entity ON audit_events(entity_type, entity_id);
    CREATE INDEX idx_audit_events_created_at ON audit_events(created_at DESC);
    CREATE INDEX idx_audit_events_action ON audit_events(action);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS user_notification_state;
    DROP TABLE IF EXISTS audit_events;
    DROP TABLE IF EXISTS live_location_sessions;
    DROP TABLE IF EXISTS diary_entries;
  `);
};

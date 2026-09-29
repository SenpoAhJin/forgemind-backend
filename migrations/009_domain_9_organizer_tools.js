/**
 * Domain 9: Organizer Tools
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 9: ORGANIZER TOOLS"
 * Tables: commitment_change_log, invite_meetups, invite_meetup_participants,
 *         calendar_entries  (4)
 *
 * Schema decisions honoured:
 *  - Defect #5: commitment_change_log uses entity_type, corrected to
 *    ('event','logistics_entry') to match the app's entityType union.
 *    Source: src/types/organizerTypes.ts:5
 *  - Defect #6: commit_before_item removed; commitment type is a single enum
 *    ('cosplay_commitment','logistics_commitment','event_commitment').
 *  - Defect #10: calendar_entries has ONE date NOT NULL. No end_date column,
 *    and nullable is_required is expressed as 0/1, not NULL.
 *    Source: src/types/calendar.ts:4,6,8,12
 *  - A3 item 16: UNIQUE invite_code; UNIQUE staff assignment per meetup
 *    (staff_user_id + staff_role) so one user cannot hold two staff roles
 *    on the same meetup.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE commitment_change_log (
      change_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      -- CORRECTED (v2.1): 'guest_logistics_entry' -> 'logistics_entry'
      entity_type     VARCHAR(30) NOT NULL
                      CHECK (entity_type IN ('event', 'logistics_entry')),
      entity_id       UUID NOT NULL,
      field_name      VARCHAR(100) NOT NULL,
      old_value       TEXT NULL,
      new_value       TEXT NULL,
      changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      changed_by      VARCHAR(100) NOT NULL
    );

    CREATE TABLE invite_meetups (
      meetup_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invite_code        VARCHAR(50) NOT NULL UNIQUE,
      meetup_name        VARCHAR(200) NOT NULL,
      description        TEXT NULL,
      meetup_date        DATE NOT NULL,
      start_time         TIME NOT NULL,
      end_time           TIME NOT NULL,
      location           VARCHAR(200) NOT NULL,
      capacity           INTEGER NULL,
      creator_user_id    UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE invite_meetup_participants (
      participant_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      meetup_id         UUID NOT NULL REFERENCES invite_meetups(meetup_id) ON DELETE CASCADE,
      cosplay_name      VARCHAR(200) NOT NULL,
      contact_email     VARCHAR(255) NOT NULL,
      contact_phone     VARCHAR(50) NULL,
      user_id           UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      rsvp_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (rsvp_status IN ('pending', 'confirmed', 'declined')),
      registered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- v2.1: staff_user_id / staff_role / assigned_at. The column is named
    -- staff_user_id to stay consistent with guest_logistics.assigned_to_staff_user_id.
    CREATE TABLE calendar_entries (
      calendar_entry_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id            UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      entry_date         DATE NOT NULL,
      -- Defect #10: single NOT NULL date. is_required is 0/1, never NULL,
      -- because the app's CalendarEntry type declares is_required: boolean.
      -- Source: src/types/calendar.ts:4,6
      is_required        INTEGER NOT NULL DEFAULT 0
                        CHECK (is_required IN (0, 1)),
      entry_type         VARCHAR(20) NOT NULL
                        CHECK (entry_type IN
                               ('work_shift', 'project_deadline', 'event_date', 'item_sale',
                                'borrow_return', 'meetup', 'contest_date', 'block_prevention',
                                'other')),
      related_project_id UUID NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      related_event_id   UUID NULL REFERENCES events(event_id) ON DELETE CASCADE,
      notes              TEXT NULL
    );

    CREATE INDEX idx_commitment_change_log_entity ON commitment_change_log(entity_type, entity_id);
    CREATE INDEX idx_commitment_change_log_changed_at
      ON commitment_change_log(changed_at DESC);

    CREATE UNIQUE INDEX idx_invite_meetups_invite_code ON invite_meetups(invite_code);
    CREATE INDEX idx_invite_meetups_date ON invite_meetups(meetup_date);

    CREATE INDEX idx_invite_meetup_participants_meetup_id
      ON invite_meetup_participants(meetup_id);
    CREATE UNIQUE INDEX idx_unique_invite_meetup_participant
      ON invite_meetup_participants(meetup_id, contact_email);
    CREATE INDEX idx_invite_meetup_participants_rsvp
      ON invite_meetup_participants(meetup_id, rsvp_status);

    CREATE INDEX idx_calendar_entries_user_id ON calendar_entries(user_id);
    CREATE INDEX idx_calendar_entries_date ON calendar_entries(entry_date);
    CREATE INDEX idx_calendar_entries_required
      ON calendar_entries(user_id, entry_date) WHERE is_required = 1;
    CREATE INDEX idx_calendar_entries_type ON calendar_entries(entry_type);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS calendar_entries;
    DROP TABLE IF EXISTS invite_meetup_participants;
    DROP TABLE IF EXISTS invite_meetups;
    DROP TABLE IF EXISTS commitment_change_log;
  `);
};

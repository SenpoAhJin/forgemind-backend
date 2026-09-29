/**
 * Domain 8: Events
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 8: EVENTS"
 * Tables: events, event_participant_applications, guest_logistics,
 *         group_meetups, meetup_members, contest_criteria, contest_opt_ins  (7)
 *
 * ORDERING NOTE — deferred foreign key:
 *   This migration closes Domain 6's deferred FK (projects.linked_event_id -> events),
 *   because events is created here.
 *
 * A/B/C CORRECTIONS APPLIED IN THIS FILE (all grep-verified against src/):
 *
 *   events.status
 *     CORRECTED to ('draft','confirmed','cancelled'). v2 wrongly added 'ongoing' and
 *     'completed'; those had NO source anywhere in the app.
 *     Source: src/types/events.ts:7
 *
 *   guest_logistics.participant_kind
 *     CORRECTED to ('confirmed_guest','sponsor','performer'). v2 wrongly used 'guest'.
 *     Source: src/types/logistics.ts:6
 *
 *   guest_logistics.parking_needs
 *     CORRECTED to ('none','standard','accessible'). v2 wrongly used
 *     ('yes','no','accessible'). Ordinal scale, not boolean.
 *     Source: src/types/logistics.ts:8, src/utils/logisticsRules.ts:57
 *
 *   event_participant_applications.applicant_type
 *     REMOVED. The field does not exist in the app and was never sourced.
 *
 *   group_meetups.status  (+ its CHECK + its index)
 *     REMOVED. The Meetup type has no status field at all.
 *     group_meetups also rebuilt: meetup_name -> title, confirmed_time and
 *     confirmed_location removed, event_id made NOT NULL.
 *     Source: src/types/meetups.ts:29-42
 *
 *   meetup_members.rsvp_status
 *     CORRECTED to ('going','maybe','declined') with NO DEFAULT. v2 wrongly used
 *     ('pending','attending','declined'); 'attending' has zero matches in src/.
 *     priority_level REMOVED (zero matches). user_id -> cosplayer_email.
 *     Source: src/types/meetups.ts:12,14,16-27,39
 *
 *   A3 item 16: contest opt-in UNIQUE per (event_id, cosplayer_user_id).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE events (
      event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organizer_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      event_name      VARCHAR(200) NOT NULL,
      start_date      DATE NOT NULL,
      -- v2.2 RECONCILIATION: relaxed to NULLable. The approved doc said NOT NULL, but
      -- src/types/events.ts:16 declares "end_date?: string | null" and
      -- src/contexts/CalendarContext.tsx:141 guards "if (input.end_date && ...)",
      -- proving NULL is a normal persisted state. Seed row
      -- "event-davao-cosplay-meet-cancelled" already stores end_date: null.
      -- The doc's NOT NULL would have rejected records the app itself creates.
      end_date        DATE NULL,
      -- v2.2 RECONCILIATION: relaxed to NULLable. src/types/events.ts:14 declares
      -- city?: string | null. The doc's NOT NULL contradicted the app.
      city            VARCHAR(100) NULL,
      venue_name      VARCHAR(200) NOT NULL,
      -- v2.2 RECONCILIATION: REMOVED. "venue_address" had ZERO references in app
      -- code (recursive grep: 2 hits, both inside the schema docs themselves).
      -- src/types/events.ts carries only venue_name + city. Keeping it NOT NULL
      -- would force every insert to invent an address no screen collects or shows.
      description     TEXT NULL,
      has_contest     BOOLEAN NOT NULL DEFAULT false,
      -- CORRECTED (v2.1): no 'ongoing', no 'completed'
      status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'confirmed', 'cancelled')),
      confirmed_at    TIMESTAMPTZ NULL,
      cancelled_at    TIMESTAMPTZ NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- A: applicant_type REMOVED (field never existed in the app).
    -- NOTE: this table as a whole is still flagged UNVERIFIED in the schema doc's
    -- "STILL OPEN" section. guest_logistics.source_application_id references it.
    CREATE TABLE event_participant_applications (
      application_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id                UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      applicant_name          VARCHAR(200) NOT NULL,
      applicant_contact_email VARCHAR(255) NOT NULL,
      applicant_contact_phone VARCHAR(50) NULL,
      application_details     TEXT NOT NULL,
      application_status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                              CHECK (application_status IN ('pending', 'approved', 'rejected')),
      reviewed_by_organizer_id UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      review_notes            TEXT NULL,
      submitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at             TIMESTAMPTZ NULL
    );

    CREATE TABLE guest_logistics (
      logistics_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id                  UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      source_application_id     UUID NULL
                                REFERENCES event_participant_applications(application_id)
                                ON DELETE SET NULL,
      -- CORRECTED (v2.1): 'guest' -> 'confirmed_guest'
      participant_kind          VARCHAR(20) NOT NULL
                                CHECK (participant_kind IN
                                       ('confirmed_guest', 'sponsor', 'performer')),
      participant_name          VARCHAR(200) NOT NULL,
      participant_contact_email VARCHAR(255) NULL,
      arrival_date              DATE NULL,
      arrival_time              TIME NULL,
      plate_number              VARCHAR(50) NULL,
      entourage_size            INTEGER NULL,
      stage_time_needs          TEXT NULL,
      -- CORRECTED (v2.1): ('yes','no','accessible') -> ('none','standard','accessible')
      parking_needs             VARCHAR(20) NULL
                                CHECK (parking_needs IN ('none', 'standard', 'accessible')),
      submission_deadline       DATE NULL,
      status                    VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'active', 'withdrawn')),
      assigned_to_staff_user_id UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      assigned_at               TIMESTAMPTZ NULL,
      assigned_by_user_id       UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- B: status column, its CHECK and its index REMOVED (Meetup has no status).
    --    Rebuilt against src/types/meetups.ts:29-42.
    CREATE TABLE group_meetups (
      meetup_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id           UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      proposed_by_email  VARCHAR(255) NOT NULL,
      proposed_by_name   VARCHAR(200) NOT NULL,
      title              VARCHAR(200) NOT NULL,
      purpose            TEXT NULL,
      proposed_date      DATE NOT NULL,
      proposed_time      TIME NOT NULL,
      proposed_location  VARCHAR(200) NOT NULL,
      created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- C: rsvp_status CORRECTED to ('going','maybe','declined'), no DEFAULT.
    --    priority_level REMOVED. user_id -> cosplayer_email.
    CREATE TABLE meetup_members (
      rsvp_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      meetup_id        UUID NOT NULL REFERENCES group_meetups(meetup_id) ON DELETE CASCADE,
      cosplayer_email  VARCHAR(255) NOT NULL,
      cosplayer_name   VARCHAR(200) NOT NULL,
      rsvp_status      VARCHAR(20) NOT NULL
                       CHECK (rsvp_status IN ('going', 'maybe', 'declined')),
      responded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE contest_criteria (
      criterion_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id      UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      label         VARCHAR(200) NOT NULL,
      description   TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE contest_opt_ins (
      opt_in_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id               UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
      cosplayer_user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      cosplayer_email        VARCHAR(255) NOT NULL,
      cosplayer_display_name VARCHAR(100) NOT NULL,
      status                 VARCHAR(20) NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'confirmed', 'declined')),
      assigned_tier_id       UUID NULL REFERENCES contest_criteria(criterion_id) ON DELETE SET NULL,
      assigned_at            TIMESTAMPTZ NULL,
      confirmed_by_user_id   UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      confirmed_at           TIMESTAMPTZ NULL,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_events_organizer_user_id ON events(organizer_user_id);
    CREATE INDEX idx_events_start_date ON events(start_date);
    CREATE INDEX idx_events_status ON events(status);
    CREATE INDEX idx_events_city ON events(city);

    CREATE INDEX idx_event_participant_applications_event_id
      ON event_participant_applications(event_id);
    CREATE INDEX idx_event_participant_applications_status
      ON event_participant_applications(application_status);

    CREATE INDEX idx_guest_logistics_event_id ON guest_logistics(event_id);
    CREATE INDEX idx_guest_logistics_participant_kind ON guest_logistics(participant_kind);
    CREATE INDEX idx_guest_logistics_status ON guest_logistics(status);
    CREATE INDEX idx_guest_logistics_assigned_to
      ON guest_logistics(assigned_to_staff_user_id) WHERE assigned_to_staff_user_id IS NOT NULL;
    -- A3 item 16: one staff member assigned to one logistics entry at a time
    CREATE UNIQUE INDEX idx_unique_staff_assignment
      ON guest_logistics(assigned_to_staff_user_id)
      WHERE status = 'active' AND assigned_to_staff_user_id IS NOT NULL;

    CREATE INDEX idx_group_meetups_event_id ON group_meetups(event_id);
    CREATE INDEX idx_group_meetups_proposed_by ON group_meetups(proposed_by_email);
    -- B: idx_group_meetups_status deliberately NOT created (column removed).

    CREATE INDEX idx_meetup_members_meetup_id ON meetup_members(meetup_id);
    CREATE UNIQUE INDEX idx_unique_meetup_member ON meetup_members(meetup_id, cosplayer_email);

    CREATE INDEX idx_contest_criteria_event_id ON contest_criteria(event_id);

    CREATE INDEX idx_contest_opt_ins_event_id ON contest_opt_ins(event_id);
    CREATE INDEX idx_contest_opt_ins_cosplayer_user_id ON contest_opt_ins(cosplayer_user_id);
    CREATE INDEX idx_contest_opt_ins_status ON contest_opt_ins(status);
    -- A3 item 16: one opt-in per (event, cosplayer)
    CREATE UNIQUE INDEX idx_unique_contest_opt_in ON contest_opt_ins(event_id, cosplayer_user_id);

    -- Close out Domain 6's deferred foreign key now that events exists.
    ALTER TABLE projects
      ADD CONSTRAINT projects_linked_event_id_fkey
      FOREIGN KEY (linked_event_id) REFERENCES events(event_id) ON DELETE SET NULL;

    CREATE INDEX idx_projects_linked_event_id
      ON projects(linked_event_id) WHERE linked_event_id IS NOT NULL;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_linked_event_id_fkey;
    DROP INDEX IF EXISTS idx_projects_linked_event_id;

    DROP TABLE IF EXISTS contest_opt_ins;
    DROP TABLE IF EXISTS contest_criteria;
    DROP TABLE IF EXISTS meetup_members;
    DROP TABLE IF EXISTS group_meetups;
    DROP TABLE IF EXISTS guest_logistics;
    DROP TABLE IF EXISTS event_participant_applications;
    DROP TABLE IF EXISTS events;
  `);
};

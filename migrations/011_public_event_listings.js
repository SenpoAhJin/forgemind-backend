/**
 * Public Event Calendar Migration
 * Community-submitted event listings (cosplay.ph-style public directory)
 * 
 * DISTINCT from personal calendar_entries (Domain 9) - this is for PUBLIC event discovery.
 * Staff submit -> pending approval. Head approves within department. Approved events visible to all.
 * 
 * Date fields: DATE type (YYYY-MM-DD), no time component. UI uses DateInput with YYYY-MM-DD strings.
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE public_event_listings (
      id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title                     VARCHAR(100) NOT NULL
                                CHECK (char_length(title) >= 3),
      organizer_name            VARCHAR(200) NOT NULL,
      venue_name                VARCHAR(200) NOT NULL,
      city                      VARCHAR(100) NOT NULL,
      start_date                DATE NOT NULL,
      end_date                  DATE NULL
                                CHECK (end_date IS NULL OR end_date >= start_date),
      description               TEXT NULL
                                CHECK (description IS NULL OR char_length(description) <= 500),
      external_link             TEXT NULL,
      submitted_by_user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      submitted_by_department   VARCHAR(50) NULL,
      status                    VARCHAR(20) NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'rejected')),
      reviewed_by_user_id       UUID NULL REFERENCES users(user_id) ON DELETE SET NULL,
      reviewed_at               TIMESTAMPTZ NULL,
      rejection_reason          TEXT NULL,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Index for list queries: status-based filtering + date sorting
    CREATE INDEX idx_public_event_listings_status_date
      ON public_event_listings(status, start_date DESC);

    -- Index for department-routed approval
    CREATE INDEX idx_public_event_listings_dept_status
      ON public_event_listings(submitted_by_department, status)
      WHERE submitted_by_department IS NOT NULL;

    -- Index for submitter's own listings
    CREATE INDEX idx_public_event_listings_submitter
      ON public_event_listings(submitted_by_user_id, status);

    -- Index for date-based queries (upcoming events)
    CREATE INDEX idx_public_event_listings_start_date
      ON public_event_listings(start_date DESC);

    COMMENT ON TABLE public_event_listings IS
      'Public event calendar - community-submitted cosplay event listings. Distinct from personal calendar_entries table.';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE IF EXISTS public_event_listings CASCADE;
  `);
};

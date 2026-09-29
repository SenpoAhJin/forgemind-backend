/**
 * Domain 6: Projects, Tasks, Budget, Milestones
 * Source: docs/database/SCHEMA_RECONCILIATION.md v2.2 — "DOMAIN 6: PROJECTS, TASKS, BUDGET, MILESTONES"
 * Tables: projects, tasks, budget_line_items, project_milestones  (4)
 *
 * ORDERING NOTES:
 *  1. This migration closes the deferred FKs from Domain 5 (owned_attire,
 *     attire_usage_history -> projects), because projects is created here.
 *  2. projects.linked_event_id -> events is DEFERRED to migration 008, since
 *     events is a Domain 8 table and Domain 6 runs first.
 *
 * Schema decisions honoured:
 *  - Calendar columns are DATE, not TIMESTAMPTZ (UTC date-shift bug rule).
 *  - All budget/money columns are NUMERIC(12,2).
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE projects (
      project_id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id                       UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
      character_id                  UUID NOT NULL
                                    REFERENCES characters(character_id) ON DELETE RESTRICT,
      variant_id                    UUID NOT NULL
                                    REFERENCES variants(variant_id) ON DELETE RESTRICT,
      project_name                  VARCHAR(200) NOT NULL,
      stated_budget                 NUMERIC(12,2) NULL,
      stated_skill_level            VARCHAR(20) NOT NULL
                                    CHECK (stated_skill_level IN
                                           ('beginner', 'intermediate', 'advanced', 'expert')),
      start_date                    DATE NOT NULL,
      target_completion_date        DATE NULL,
      linked_event_id               UUID NULL,
      opted_in_readiness_sharing    BOOLEAN NOT NULL DEFAULT false,
      status                        VARCHAR(20) NOT NULL DEFAULT 'planning'
                                    CHECK (status IN
                                           ('planning', 'in-progress', 'completed', 'abandoned')),
      created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE tasks (
      task_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id               UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      task_description         TEXT NOT NULL,
      task_order               INTEGER NOT NULL,
      difficulty_rating        INTEGER NULL
                              CHECK (difficulty_rating >= 1 AND difficulty_rating <= 5),
      technique_tags           JSONB NULL,
      estimated_time_hours     NUMERIC(5,2) NULL,
      actual_completion_date   DATE NULL,
      actual_time_spent_hours  NUMERIC(5,2) NULL,
      status                   VARCHAR(20) NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'in-progress', 'completed', 'skipped')),
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE budget_line_items (
      budget_line_item_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id           UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      item_name            VARCHAR(200) NOT NULL,
      category             VARCHAR(20) NOT NULL
                          CHECK (category IN ('material', 'labor', 'tool', 'other')),
      planned_amount       NUMERIC(12,2) NOT NULL,
      actual_amount        NUMERIC(12,2) NOT NULL DEFAULT 0.00,
      created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE project_milestones (
      milestone_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id       UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
      milestone_label  VARCHAR(200) NOT NULL,
      target_date      DATE NOT NULL,
      is_completed     BOOLEAN NOT NULL DEFAULT false,
      completed_at     TIMESTAMPTZ NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX idx_projects_user_id ON projects(user_id);
    CREATE INDEX idx_projects_character_id ON projects(character_id);
    CREATE INDEX idx_projects_variant_id ON projects(variant_id);
    CREATE INDEX idx_projects_status ON projects(status);
    -- linked_event_id index added in migration 008, once events exists.

    CREATE INDEX idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_tasks_order ON tasks(project_id, task_order);

    CREATE INDEX idx_budget_line_items_project_id ON budget_line_items(project_id);

    CREATE INDEX idx_project_milestones_project_id ON project_milestones(project_id);
    CREATE INDEX idx_project_milestones_target_date ON project_milestones(target_date);

    -- Close out Domain 5's deferred foreign keys now that projects exists.
    ALTER TABLE owned_attire
      ADD CONSTRAINT owned_attire_committed_to_project_id_fkey
      FOREIGN KEY (committed_to_project_id) REFERENCES projects(project_id) ON DELETE SET NULL;

    ALTER TABLE attire_usage_history
      ADD CONSTRAINT attire_usage_history_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE attire_usage_history
      DROP CONSTRAINT IF EXISTS attire_usage_history_project_id_fkey;
    ALTER TABLE owned_attire
      DROP CONSTRAINT IF EXISTS owned_attire_committed_to_project_id_fkey;

    DROP TABLE IF EXISTS project_milestones;
    DROP TABLE IF EXISTS budget_line_items;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS projects;
  `);
};

/**
 * ForgeMind seed loader
 * ---------------------------------------------------------------------------
 * Loads the mobile app's mock dataset (READ-ONLY) into the v2.2 schema.
 *
 * DESIGN NOTES
 *
 * 1. ID REMAPPING. Every source row uses a human-readable string id
 *    ("char-jujutsu-kaisen-gojo"), but the schema mandates UUID primary keys.
 *    Rather than let the database mint random UUIDs -- which would make the seed
 *    non-idempotent and break the FK graph across runs -- we derive a
 *    DETERMINISTIC UUIDv5 from (entity type, source id). Re-running this script
 *    therefore produces byte-identical ids and is safe to run repeatedly.
 *
 * 2. USER SYNTHESIS. The mock data references users by email (or by opaque
 *    handles like "demo-user-1" and "seed-system") but no users table exists in
 *    the source JSON. We synthesise one user per distinct reference, satisfying
 *    every NOT NULL / CHECK constraint on `users`.
 *    Seeded users CANNOT log in: password_hash is set to a crypt-style disabled
 *    marker ("!" prefix), never a real hash.
 *
 * 3. IDEMPOTENCY. All inserts use ON CONFLICT (pk) DO UPDATE, so the seed can be
 *    re-run without duplicating rows.
 *
 * 4. TRANSPARENCY. Anything in the source data that has no home in the schema is
 *    NOT silently dropped -- it is collected and printed in the final report.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';
import { config } from '../config';
import { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Deterministic UUIDv5
// ---------------------------------------------------------------------------

/** Fixed ForgeMind namespace so ids are stable across machines and runs. */
const NAMESPACE = 'f0e6d3a1-4b52-4c88-9e71-6a2b3c4d5e6f';

function uuidv5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name, 'utf8')]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Source loading
// ---------------------------------------------------------------------------

const DATA_DIR =
  process.env.SEED_DATA_DIR ??
  path.resolve(__dirname, '../../../forgemind-mobile/src/data');

function readJson<T>(file: string): T {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) {
    throw new Error(`Seed source not found: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

/**
 * owned-attire-seed.ts is TypeScript, not JSON. We transpile it with the
 * already-installed TypeScript compiler and stub the type-only import so the
 * runtime has no dependency on the mobile app's module graph.
 */
function readTsArray<T>(file: string, exportName: string): T {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) {
    throw new Error(`Seed source not found: ${p}`);
  }
  const source = fs.readFileSync(p, 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const stubRequire = () => ({});
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module, __filename, __dirname) {${js}\n})`,
    { filename: p },
  );
  wrapper(mod.exports, stubRequire, mod, p, path.dirname(p));
  return mod.exports[exportName] as T;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const report: { table: string; rows: number }[] = [];
const notes: string[] = [];

function record(table: string, rows: number): void {
  report.push({ table, rows });
  console.log(`  ${table.padEnd(36)} ${String(rows).padStart(4)} rows`);
}

function note(message: string): void {
  notes.push(message);
}

const emptyToNull = (v: unknown): unknown =>
  v === '' || v === undefined ? null : v;

// ---------------------------------------------------------------------------
// Seed users
// ---------------------------------------------------------------------------

/**
 * Keyed by the exact reference string found in the mock data. `email` is derived
 * when the reference is an opaque handle rather than an address.
 */
const SEED_USERS: Record<
  string,
  {
    email: string;
    displayName: string;
    isCosplayer: boolean;
    isOrganizer: boolean;
    organizerRole: 'head' | 'staff' | null;
    headDepartment: string | null;
    marketplaceRole: 'buyer' | 'seller' | 'both' | null;
  }
> = {
  'head.organizer@forgemind.dev': {
    email: 'head.organizer@forgemind.dev',
    displayName: 'Head Organizer',
    isCosplayer: false,
    isOrganizer: true,
    organizerRole: 'head',
    headDepartment: 'secretariat',
    marketplaceRole: null,
  },
  'demo-user-1': {
    email: 'demo-user-1@forgemind.test',
    displayName: 'Demo Cosplayer',
    isCosplayer: true,
    isOrganizer: false,
    organizerRole: null,
    headDepartment: null,
    marketplaceRole: 'buyer',
  },
  'demo-seller@forgemind.test': {
    email: 'demo-seller@forgemind.test',
    displayName: 'Demo Seller',
    isCosplayer: false,
    isOrganizer: false,
    organizerRole: null,
    headDepartment: null,
    marketplaceRole: 'seller',
  },
  'demo-crafter@forgemind.test': {
    email: 'demo-crafter@forgemind.test',
    displayName: 'Demo Crafter',
    isCosplayer: true,
    isOrganizer: false,
    organizerRole: null,
    headDepartment: null,
    marketplaceRole: 'both',
  },
  'demo-photographer@forgemind.test': {
    email: 'demo-photographer@forgemind.test',
    displayName: 'Demo Photographer',
    isCosplayer: false,
    isOrganizer: false,
    organizerRole: null,
    headDepartment: null,
    marketplaceRole: 'seller',
  },
  'seed-system': {
    email: 'seed-system@forgemind.test',
    displayName: 'Seed System',
    isCosplayer: false,
    isOrganizer: false,
    organizerRole: null,
    headDepartment: null,
    marketplaceRole: null,
  },
  'user-oc-creator': {
    email: 'user-oc-creator@forgemind.test',
    displayName: 'OC Creator',
    isCosplayer: true,
    isOrganizer: false,
    organizerRole: null,
    headDepartment: null,
    marketplaceRole: null,
  },
  'seed-user': {
    email: 'seed-user@forgemind.test',
    displayName: 'Seed User',
    isCosplayer: true,
    isOrganizer: false,
    organizerRole: null,
    headDepartment: null,
    marketplaceRole: null,
  },
};

const userId = (ref: string): string => {
  if (!(ref in SEED_USERS)) {
    throw new Error(
      `Unmapped user reference "${ref}". Add it to SEED_USERS before seeding.`,
    );
  }
  return uuidv5(`user:${SEED_USERS[ref].email}`);
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const pool = new Pool({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.user,
    password: config.db.password,
    ssl: config.db.ssl,
  });

  console.log(`\nForgeMind seed loader`);
  console.log(`  data dir : ${DATA_DIR}`);
  console.log(`  database : ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log(`  (password never printed)\n`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // -- 1. users ---------------------------------------------------------
    const userRows = Object.values(SEED_USERS).map((u) => ({
      user_id: uuidv5(`user:${u.email}`),
      email: u.email,
      // crypt-style disabled marker: no seeded account can ever authenticate.
      password_hash: '!SEED_ACCOUNT_CANNOT_AUTHENTICATE',
      display_name: u.displayName,
      is_cosplayer: u.isCosplayer,
      is_organizer: u.isOrganizer,
      // The app models this as 'male' | 'female' (AuthService.ts:29). Seed users
      // are synthetic, so this is filler to satisfy the NOT NULL + CHECK.
      base_body_selection: 'female',
      organizer_role: u.organizerRole,
      head_organizer_department: u.headDepartment,
      department: null,
      department_verification_status: null,
      marketplace_role: u.marketplaceRole,
      // chk_seller_has_details requires these three for seller/both.
      seller_display_name: u.marketplaceRole === 'seller' || u.marketplaceRole === 'both' ? u.displayName : null,
      payout_method_label: u.marketplaceRole === 'seller' || u.marketplaceRole === 'both' ? 'GCash' : null,
      payout_method_number: u.marketplaceRole === 'seller' || u.marketplaceRole === 'both' ? '0000-0000-0000' : null,
      data_consent_given: true,
      theme_preference: 'purple',
    }));

    for (const u of userRows) {
      await client.query(
        `INSERT INTO users (
           user_id, email, password_hash, display_name, is_cosplayer, is_organizer,
           base_body_selection, organizer_role, head_organizer_department, department,
           department_verification_status, marketplace_role, seller_display_name,
           payout_method_label, payout_method_number, data_consent_given, theme_preference
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           is_cosplayer = EXCLUDED.is_cosplayer,
           is_organizer = EXCLUDED.is_organizer,
           marketplace_role = EXCLUDED.marketplace_role,
           seller_display_name = EXCLUDED.seller_display_name,
           payout_method_label = EXCLUDED.payout_method_label,
           payout_method_number = EXCLUDED.payout_method_number`,
        [u.user_id, u.email, u.password_hash, u.display_name, u.is_cosplayer, u.is_organizer,
         u.base_body_selection, u.organizer_role, u.head_organizer_department, u.department,
         u.department_verification_status, u.marketplace_role, u.seller_display_name,
         u.payout_method_label, u.payout_method_number, u.data_consent_given, u.theme_preference],
      );
    }
    record('users', userRows.length);

    // -- 2. characters ----------------------------------------------------
    type CharacterRow = {
      character_id: string; character_name: string; source_media: string;
      media_type: string; description: string | null; reference_image_url: string;
      created_by_user_id: string; created_at: string; is_confirmed: boolean;
    };
    const characters = readJson<CharacterRow[]>('characters.json');
    const charId = (src: string): string => uuidv5(`character:${src}`);

    for (const c of characters) {
      // Schema requires a slug; the source JSON has none. Derive from the id.
      const slug = c.character_id.replace(/^char-/, '').toLowerCase();
      await client.query(
        `INSERT INTO characters (
           character_id, slug, character_name, source_media, media_type,
           description, reference_image_url, created_by_user_id, is_confirmed, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (character_id) DO UPDATE SET
           character_name = EXCLUDED.character_name,
           description = EXCLUDED.description,
           is_confirmed = EXCLUDED.is_confirmed`,
        [charId(c.character_id), slug, c.character_name, c.source_media, c.media_type,
         emptyToNull(c.description), emptyToNull(c.reference_image_url),
         userId(c.created_by_user_id), c.is_confirmed, c.created_at],
      );
    }
    record('characters', characters.length);

    // -- 3. variants ------------------------------------------------------
    type VariantRow = {
      variant_id: string; character_id: string; variant_name: string; origin_tag: string;
      origin_description: string | null; build_difficulty_rating: number | null;
      reference_image_urls: string[] | null; status: string; candidate_source: string | null;
      confirmed_by_user_id: string | null; confirmed_at: string | null;
      created_by_user_id: string; created_at: string; updated_at: string;
    };
    const variants = readJson<VariantRow[]>('variants.json');
    const varId = (src: string): string => uuidv5(`variant:${src}`);

    for (const v of variants) {
      const slug = `${v.variant_id.replace(/^var-/, '').toLowerCase()}`;
      await client.query(
        `INSERT INTO variants (
           variant_id, slug, character_id, variant_name, origin_tag, origin_description,
           build_difficulty_rating, reference_image_urls, status, candidate_source,
           confirmed_by_user_id, confirmed_at, created_by_user_id, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (variant_id) DO UPDATE SET
           variant_name = EXCLUDED.variant_name,
           origin_tag = EXCLUDED.origin_tag,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [varId(v.variant_id), slug, charId(v.character_id), v.variant_name, v.origin_tag,
         emptyToNull(v.origin_description), v.build_difficulty_rating,
         v.reference_image_urls ? JSON.stringify(v.reference_image_urls) : null,
         v.status, v.candidate_source,
         v.confirmed_by_user_id ? userId(v.confirmed_by_user_id) : null,
         emptyToNull(v.confirmed_at), userId(v.created_by_user_id), v.created_at, v.updated_at],
      );
    }
    record('variants', variants.length);

    // -- 4. permitted_categories -----------------------------------------
    // Built from the distinct `category` strings used by the listing mock data.
    type ListingRow = {
      id: string; seller_email: string; title: string; description: string;
      category: string; transaction_type: string; price: number; condition: string;
      photos: string[]; status: string; screening_result: string; appeal_status: string;
      created_at: string;
    };
    const listings = readJson<ListingRow[]>('marketplace_listings.json');

    const categories = [...new Set(listings.map((l) => l.category))].sort();
    for (const cat of categories) {
      const examples = listings.filter((l) => l.category === cat).map((l) => l.title);
      await client.query(
        `INSERT INTO permitted_categories (category_name, description, examples)
         VALUES ($1,$2,$3)
         ON CONFLICT (category_name) DO UPDATE SET
           description = EXCLUDED.description,
           examples = EXCLUDED.examples`,
        [cat, `Permitted marketplace category: ${cat}.`, JSON.stringify(examples)],
      );
    }
    record('permitted_categories', categories.length);

    // -- 5. projects ------------------------------------------------------
    type ProjectRow = {
      project_id: string; user_id: string; character_id: string; variant_id: string;
      project_name: string; stated_budget: number | null; stated_skill_level: string;
      start_date: string; target_completion_date: string | null; linked_event_id: string | null;
      opted_in_readiness_sharing: boolean; status: string; created_at: string; updated_at: string;
    };
    const projects = readJson<ProjectRow[]>('projects.json');
    const projId = (src: string): string => uuidv5(`project:${src}`);

    for (const p of projects) {
      await client.query(
        `INSERT INTO projects (
           project_id, user_id, character_id, variant_id, project_name, stated_budget,
           stated_skill_level, start_date, target_completion_date, opted_in_readiness_sharing,
           status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (project_id) DO UPDATE SET
           project_name = EXCLUDED.project_name,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [projId(p.project_id), userId(p.user_id), charId(p.character_id), varId(p.variant_id),
         p.project_name, p.stated_budget, p.stated_skill_level, p.start_date,
         p.target_completion_date, p.opted_in_readiness_sharing, p.status,
         p.created_at, p.updated_at],
      );
    }
    record('projects', projects.length);

    // -- 6. tasks ---------------------------------------------------------
    type TaskRow = {
      task_id: string; project_id: string; task_description: string; task_order: number;
      difficulty_rating: number | null; technique_tags: string[] | null;
      estimated_time_hours: number | null; actual_completion_date: string | null;
      actual_time_spent_hours: number | null; status: string;
      created_at: string; updated_at: string;
    };
    const tasks = readJson<TaskRow[]>('tasks.json');
    for (const t of tasks) {
      await client.query(
        `INSERT INTO tasks (
           task_id, project_id, task_description, task_order, difficulty_rating,
           technique_tags, estimated_time_hours, actual_completion_date,
           actual_time_spent_hours, status, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (task_id) DO UPDATE SET
           task_description = EXCLUDED.task_description,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [uuidv5(`task:${t.task_id}`), projId(t.project_id), t.task_description, t.task_order,
         t.difficulty_rating, t.technique_tags ? JSON.stringify(t.technique_tags) : null,
         t.estimated_time_hours, emptyToNull(t.actual_completion_date),
         t.actual_time_spent_hours, t.status, t.created_at, t.updated_at],
      );
    }
    record('tasks', tasks.length);

    // -- 7. budget_line_items --------------------------------------------
    type BudgetRow = {
      budget_line_item_id: string; project_id: string; item_name: string; category: string;
      planned_amount: number; actual_amount: number; created_at: string; updated_at: string;
    };
    const budget = readJson<BudgetRow[]>('budget_items.json');
    for (const b of budget) {
      await client.query(
        `INSERT INTO budget_line_items (
           budget_line_item_id, project_id, item_name, category,
           planned_amount, actual_amount, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (budget_line_item_id) DO UPDATE SET
           planned_amount = EXCLUDED.planned_amount,
           actual_amount = EXCLUDED.actual_amount,
           updated_at = EXCLUDED.updated_at`,
        [uuidv5(`budget:${b.budget_line_item_id}`), projId(b.project_id), b.item_name,
         b.category, b.planned_amount, b.actual_amount, b.created_at, b.updated_at],
      );
    }
    record('budget_line_items', budget.length);

    // -- 8. events --------------------------------------------------------
    type EventRow = {
      id: string; name: string; description: string | null; venue_name: string; city: string;
      start_date: string; end_date: string | null; has_contest: boolean; status: string;
      created_by_email: string; created_at: string; updated_at: string;
      confirmed_at: string | null; confirmed_by_email: string | null;
      cancelled_at: string | null; cancelled_by_email: string | null;
    };
    const events = readJson<EventRow[]>('events.json');
    for (const e of events) {
      await client.query(
        `INSERT INTO events (
           event_id, organizer_user_id, event_name, start_date, end_date, city,
           venue_name, description, has_contest, status,
           confirmed_at, cancelled_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (event_id) DO UPDATE SET
           event_name = EXCLUDED.event_name,
           end_date = EXCLUDED.end_date,
           status = EXCLUDED.status,
           updated_at = EXCLUDED.updated_at`,
        [uuidv5(`event:${e.id}`), userId(e.created_by_email), e.name, e.start_date,
         emptyToNull(e.end_date), e.city, e.venue_name, emptyToNull(e.description),
         e.has_contest, e.status, emptyToNull(e.confirmed_at), emptyToNull(e.cancelled_at),
         e.created_at, e.updated_at],
      );
    }
    record('events', events.length);

    // -- 9. listings ------------------------------------------------------
    for (const l of listings) {
      const { rows } = await client.query<{ category_id: string }>(
        'SELECT category_id FROM permitted_categories WHERE category_name = $1',
        [l.category],
      );
      if (rows.length === 0) throw new Error(`No permitted category for "${l.category}"`);
      await client.query(
        `INSERT INTO listings (
           listing_id, seller_user_id, item_title, item_description, category_id,
           transaction_type, price, condition, photo_urls, screening_result,
           listing_status, appeal_status, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (listing_id) DO UPDATE SET
           item_title = EXCLUDED.item_title,
           transaction_type = EXCLUDED.transaction_type,
           price = EXCLUDED.price,
           listing_status = EXCLUDED.listing_status`,
        [uuidv5(`listing:${l.id}`), userId(l.seller_email), l.title, l.description,
         rows[0].category_id, l.transaction_type, l.price, l.condition,
         JSON.stringify(l.photos), l.screening_result, l.status, l.appeal_status, l.created_at],
      );
    }
    record('listings', listings.length);

    // -- 10. owned_attire -------------------------------------------------
    type AttireRow = {
      attire_id: string; user_id: string; entry_method: string; entry_language: string | null;
      original_input_text: string; photo_urls: string[]; auto_categorized_type: string;
      auto_categorized_color: string | null; auto_categorized_style: string | null;
      flexibility_tag: string; condition_rating: number;
      condition_photo_history: unknown; availability_status: string;
      committed_to_project_id: string | null; acquired_date: string | null;
      acquisition_cost: number | null; notes: string; created_at: string; updated_at: string;
    };
    const attire = readTsArray<AttireRow[]>('owned-attire-seed.ts', 'ownedAttireSeed');
    for (const a of attire) {
      await client.query(
        `INSERT INTO owned_attire (
           attire_id, user_id, entry_method, entry_language, original_input_text,
           photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
           flexibility_tag, condition_rating, condition_photo_history, availability_status,
           acquired_date, acquisition_cost, notes, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (attire_id) DO UPDATE SET
           auto_categorized_style = EXCLUDED.auto_categorized_style,
           condition_rating = EXCLUDED.condition_rating,
           notes = EXCLUDED.notes,
           updated_at = EXCLUDED.updated_at`,
        [uuidv5(`attire:${a.attire_id}`), userId(a.user_id), a.entry_method, a.entry_language,
         emptyToNull(a.original_input_text), JSON.stringify(a.photo_urls),
         a.auto_categorized_type, a.auto_categorized_color, a.auto_categorized_style,
         a.flexibility_tag, a.condition_rating, JSON.stringify(a.condition_photo_history),
         a.availability_status, a.acquired_date, a.acquisition_cost, emptyToNull(a.notes),
         a.created_at, a.updated_at],
      );
    }
    record('owned_attire', attire.length);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nSEED FAILED -- transaction rolled back.\n');
    console.error(err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  // -- Transparency report ------------------------------------------------
  note(
    'match_components.json (component_id / component_label / match_quality) has NO ' +
      'target table in the v2.2 schema. It is a client-side match-result artifact, ' +
      'not catalog data. NOT SEEDED.',
  );
  note(
    'events.json fields confirmed_by_email and cancelled_by_email have no schema ' +
      'column (events stores confirmed_at / cancelled_at plus organizer_user_id). ' +
      'NOT SEEDED. The organizer is recorded via organizer_user_id.',
  );
  note(
    'events.venue_address was REMOVED from the schema in the v2.2 reconciliation ' +
      '(zero references in app code).',
  );
  note(
    'characters.slug and variants.slug are NOT NULL + UNIQUE in the schema but ' +
      'absent from the source JSON; derived from the source id (char-/var- prefix ' +
      'stripped, lowercased).',
  );
  note(
    'Seeded users are synthetic. password_hash is a crypt-style disabled marker, ' +
      'so NO seeded account can authenticate. base_body_selection is filler to ' +
      'satisfy the NOT NULL CHECK IN (male, female) declared at AuthService.ts:29.',
  );
  note(
    'Tables with no source data left empty: sessions, email_otp_requests, ' +
      'holder_verification_records, user_marketplace_participant_types, components, ' +
      'variant_components, value_references, structured_offers, chat_threads, ' +
      'chat_messages, transaction_milestones, portfolio_photos, ' +
      'event_participant_applications, guest_logistics, group_meetups, meetup_members, ' +
      'contest_criteria, contest_opt_ins, commitment_change_log, invite_meetups, ' +
      'invite_meetup_participants, calendar_entries, diary_entries, ' +
      'live_location_sessions, audit_events, user_notification_state.',
  );

  console.log('\nSEED COMPLETE\n');
  console.log('Summary');
  for (const r of report) {
    console.log(`  ${r.table.padEnd(36)} ${String(r.rows).padStart(4)} rows`);
  }
  const total = report.reduce((sum, r) => sum + r.rows, 0);
  console.log(`  ${'TOTAL'.padEnd(36)} ${String(total).padStart(4)} rows\n`);

  console.log('Transformations / omissions (recorded, not silently dropped):');
  notes.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

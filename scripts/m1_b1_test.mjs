#!/usr/bin/env node
/**
 * m1_b1_test.mjs  –  Stage B1.1 verification tests
 *
 * Tests (no HTTP session auth required – uses tradeService directly for trade
 * proposal, and direct DB + fetch for inventory/listing endpoints):
 *
 *   T1.  POST /inventory creates an item scoped to the caller
 *   T2.  GET  /inventory/mine returns only the caller's items
 *   T3.  Another user cannot see caller's items via GET /inventory/mine
 *   T4.  A sell listing without item_id is rejected (400)
 *   T5.  A sell listing with an item_id owned by someone else is rejected (400)
 *   T6.  A sell listing with an item_id that is 'reserved' is rejected (400)
 *   T7.  A marketplace-verified user (verification_status='verified',
 *        marketplace_role='buyer') with is_holder_verified=FALSE can propose
 *        a trade (proves old rule is gone)
 *
 * All test data uses prefix M1B1_.
 * Cleanup runs in a finally block so leftover rows are never left on failure.
 */

import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const BASE_URL = `http://localhost:${process.env.PORT || 3000}`;
const PREFIX   = 'M1B1_';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function dbq(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}

/** Login via HTTP and return the Bearer token string. */
async function login(email, password) {
  const r = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Login failed ${r.status}: ${body}`);
  }
  const data = await r.json();
  if (!data.session_token) throw new Error('No session_token in login response');
  return data.session_token;
}

async function api(method, path, token, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${BASE_URL}${path}`, opts);
  let json;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

// ─── state ────────────────────────────────────────────────────────────────────

const createdUserIds   = [];
const createdItemIds   = [];
const createdListingIds = [];
const createdTradeIds  = [];

// ─── setup ────────────────────────────────────────────────────────────────────

async function createUser(name, opts = {}) {
  const email    = `${PREFIX}${name.toLowerCase()}@test.com`.toLowerCase();
  const password = 'TestPass123!';
  const hash     = await bcrypt.hash(password, 10);
  const rows = await dbq(
    `INSERT INTO users
       (email, password_hash, display_name, base_body_selection,
        is_holder_verified, verification_status, marketplace_role, is_cosplayer)
     VALUES ($1,$2,$3,'male',$4,$5,$6,true)
     RETURNING user_id`,
    [
      email,
      hash,
      `${PREFIX}${name}`,
      opts.is_holder_verified ?? false,          // explicitly false to prove new rule
      opts.verification_status ?? 'not_submitted',
      opts.marketplace_role   ?? null,
    ],
  );
  const user_id = rows[0].user_id;
  createdUserIds.push(user_id);
  return { user_id, email, password };
}

// ─── cleanup ──────────────────────────────────────────────────────────────────

async function cleanup() {
  console.log('\n=== CLEANUP ===\n');
  if (createdTradeIds.length) {
    await dbq(`DELETE FROM trades WHERE id = ANY($1::uuid[])`, [createdTradeIds]);
    console.log(`✓ Deleted ${createdTradeIds.length} test trade(s)`);
  }
  if (createdListingIds.length) {
    await dbq(`DELETE FROM listings WHERE listing_id = ANY($1::uuid[])`, [createdListingIds]);
    console.log(`✓ Deleted ${createdListingIds.length} test listing(s)`);
  }
  if (createdItemIds.length) {
    await dbq(`DELETE FROM owned_attire WHERE attire_id = ANY($1::uuid[])`, [createdItemIds]);
    console.log(`✓ Deleted ${createdItemIds.length} test item(s)`);
  }
  if (createdUserIds.length) {
    await dbq(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
    console.log(`✓ Deleted ${createdUserIds.length} test user(s)`);
  }
  await pool.end();
}

// ─── tests ────────────────────────────────────────────────────────────────────

const results = [];

function pass(name) { results.push({ name, ok: true  }); console.log(`  ✓ ${name}`); }
function fail(name, err) { results.push({ name, ok: false, err }); console.log(`  ✗ ${name}: ${err}`); }

async function runTests() {
  // ── users ───────────────────────────────────────────────────────────────────
  // Alice: marketplace-verified, is_holder_verified=FALSE  (key for T7)
  // Bob:   marketplace-verified, is_holder_verified=FALSE
  // Carol: marketplace-verified for isolation tests
  const alice = await createUser('Alice', {
    is_holder_verified: false,
    verification_status: 'verified',
    marketplace_role: 'buyer',
  });
  const bob = await createUser('Bob', {
    is_holder_verified: false,
    verification_status: 'verified',
    marketplace_role: 'buyer',
  });
  const carol = await createUser('Carol', {
    is_holder_verified: false,
    verification_status: 'verified',
    marketplace_role: 'buyer',
  });
  console.log(`✓ Created ${PREFIX}Alice  (${alice.user_id.slice(0,8)}…)`);
  console.log(`✓ Created ${PREFIX}Bob    (${bob.user_id.slice(0,8)}…)`);
  console.log(`✓ Created ${PREFIX}Carol  (${carol.user_id.slice(0,8)}…)`);

  // Login all three
  const tokenAlice = await login(alice.email, alice.password);
  const tokenBob   = await login(bob.email,   bob.password);
  const tokenCarol = await login(carol.email,  carol.password);
  console.log(`✓ Logged in all three test users\n`);

  // ── T1: POST /inventory creates item scoped to caller ───────────────────────
  console.log('T1: POST /inventory creates item scoped to caller');
  try {
    const r = await api('POST', '/inventory', tokenAlice, {
      entry_method: 'text',
      auto_categorized_type: 'wig',
      flexibility_tag: 'as-is-only',
      condition_rating: 4,
      notes: `${PREFIX}Alice test wig`,
    });
    assert(r.status === 201, `Expected 201, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json?.item?.attire_id, 'No attire_id in response');
    assert(r.json?.item?.user_id === alice.user_id, 'user_id mismatch');
    assert(r.json?.item?.availability_status === 'free', 'Not free');
    createdItemIds.push(r.json.item.attire_id);
    pass('T1: POST /inventory returns 201 with caller-owned free item');
  } catch (e) { fail('T1: POST /inventory', e.message); }

  // ── T2: GET /inventory/mine returns only caller's items ─────────────────────
  console.log("T2: GET /inventory/mine returns only callers items");
  try {
    // Create a second item for Bob so DB has items from two users
    const r2 = await api('POST', '/inventory', tokenBob, {
      entry_method: 'text',
      auto_categorized_type: 'clothing',
      flexibility_tag: 'as-is-only',
      condition_rating: 3,
      notes: `${PREFIX}Bob test clothing`,
    });
    assert(r2.status === 201, `Bob item create failed: ${r2.status}`);
    createdItemIds.push(r2.json.item.attire_id);

    const r = await api('GET', '/inventory/mine', tokenAlice);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const items = r.json?.items ?? [];
    const allMine = items.every(i => i.user_id === alice.user_id);
    assert(allMine, 'Some items belong to another user');
    const hasAliceItem = items.some(i => createdItemIds[0] === i.attire_id);
    assert(hasAliceItem, "Alice's item not in her list");
    pass("T2: GET /inventory/mine returns only Alice items");
  } catch (e) { fail('T2: GET /inventory/mine scoping', e.message); }

  // ── T3: Carol cannot see Alice's items ──────────────────────────────────────
  console.log("T3: Carol cannot see Alice items via /inventory/mine");
  try {
    const r = await api('GET', '/inventory/mine', tokenCarol);
    assert(r.status === 200, `Expected 200, got ${r.status}`);
    const items = r.json?.items ?? [];
    const seesAlice = items.some(i => i.user_id === alice.user_id);
    assert(!seesAlice, "Carol can see Alice items - isolation failure");
    pass('T3: /inventory/mine isolation confirmed');
  } catch (e) { fail('T3: Inventory isolation', e.message); }

  // ── T4: sell listing without item_id rejected ───────────────────────────────
  console.log('T4: sell listing without item_id rejected');
  try {
    // Get a valid category for sell
    const cats = await dbq(
      `SELECT category_id FROM permitted_categories
        WHERE is_active = true
          AND category_name NOT IN ('Services','Services & Commissions')
        LIMIT 1`,
      [],
    );
    const category_id = cats[0]?.category_id;
    assert(category_id, 'No active non-service category found');

    const r = await api('POST', '/marketplace/listings', tokenAlice, {
      title: `${PREFIX}Test sell listing no item`,
      description: 'A test cosplay wig in good condition for stage B1 validation',
      category: await dbq(`SELECT category_name FROM permitted_categories WHERE category_id=$1`,[category_id]).then(r=>r[0].category_name),
      post_type: 'sell',
      price: 500,
      condition: 'good',
      // no item_id
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.json)}`);
    assert(r.json?.error === 'validation_error', `Expected validation_error, got ${r.json?.error}`);
    pass('T4: sell listing without item_id returns 400');
  } catch (e) { fail('T4: sell without item_id', e.message); }

  // ── T5: sell listing with someone else's item_id rejected ───────────────────
  console.log("T5: sell listing with someone elses item_id rejected");
  try {
    // Bob's item is createdItemIds[1]
    const bobItemId = createdItemIds[1];
    assert(bobItemId, 'Bob item id not found');

    const cats = await dbq(
      `SELECT category_id, category_name FROM permitted_categories
        WHERE is_active = true
          AND category_name NOT IN ('Services','Services & Commissions')
        LIMIT 1`,
      [],
    );
    const { category_name } = cats[0];

    const r = await api('POST', '/marketplace/listings', tokenAlice, {
      title: `${PREFIX}Test sell listing wrong owner`,
      description: 'A test cosplay wig in good condition for stage B1 ownership check',
      category: category_name,
      post_type: 'sell',
      price: 500,
      condition: 'good',
      item_id: bobItemId,   // Alice trying to list Bob's item
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.json)}`);
    pass("T5: sell with another users item_id returns 400");
  } catch (e) { fail('T5: sell with foreign item_id', e.message); }

  // ── T6: sell listing with a reserved item_id rejected ───────────────────────
  console.log('T6: sell listing with reserved item_id rejected');
  try {
    // Create a fresh item for Alice and mark it reserved
    const itemRows = await dbq(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1,'text','clothing','as-is-only',3,'reserved',$2)
       RETURNING attire_id`,
      [alice.user_id, `${PREFIX}reserved item`],
    );
    const reservedId = itemRows[0].attire_id;
    createdItemIds.push(reservedId);

    const cats = await dbq(
      `SELECT category_name FROM permitted_categories
        WHERE is_active = true
          AND category_name NOT IN ('Services','Services & Commissions')
        LIMIT 1`,
      [],
    );
    const { category_name } = cats[0];

    const r = await api('POST', '/marketplace/listings', tokenAlice, {
      title: `${PREFIX}Test sell reserved item`,
      description: 'A test cosplay item that is reserved for stage B1 check',
      category: category_name,
      post_type: 'sell',
      price: 500,
      condition: 'good',
      item_id: reservedId,
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.json)}`);
    pass('T6: sell with reserved item_id returns 400');
  } catch (e) { fail('T6: sell with reserved item_id', e.message); }

  // ── T7: marketplace-verified user with is_holder_verified=false can propose ─
  console.log('T7: user with is_holder_verified=false, marketplace verified, can propose trade');
  try {
    // Both Alice and Bob have is_holder_verified=false but verification_status='verified'
    // and marketplace_role='buyer'. Create items for both.
    const aliceItemRow = await dbq(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1,'text','wig','as-is-only',4,'free',$2)
       RETURNING attire_id`,
      [alice.user_id, `${PREFIX}Alice swap wig`],
    );
    const aliceItemId = aliceItemRow[0].attire_id;
    createdItemIds.push(aliceItemId);

    const bobItemRow = await dbq(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1,'text','clothing','as-is-only',3,'free',$2)
       RETURNING attire_id`,
      [bob.user_id, `${PREFIX}Bob swap clothing`],
    );
    const bobItemId2 = bobItemRow[0].attire_id;
    createdItemIds.push(bobItemId2);

    // Use tradeService.proposeTrade directly (no HTTP session needed)
    const svc = await import('../dist/trades/tradeService.js');
    const tradeId = await svc.proposeTrade({
      proposer_id: alice.user_id,
      recipient_id: bob.user_id,
      type: 'swap',
      offered_item_ids: [aliceItemId],
      requested_item_ids: [bobItemId2],
      note: `${PREFIX} T7 verification rule test`,
    });
    createdTradeIds.push(tradeId);
    assert(typeof tradeId === 'string' && tradeId.length > 0, 'No trade ID returned');
    pass("T7: is_holder_verified=false + marketplace_role + verification_status=verified: trade proposed OK");
  } catch (e) { fail('T7: marketplace-verified user can propose trade', e.message); }
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  console.log('\n=== SETUP ===\n');
  try {
    await runTests();
  } finally {
    await cleanup();
  }

  console.log('\n=== RESULTS ===\n');
  let passed = 0, failed = 0;
  for (const r of results) {
    if (r.ok) { console.log(`✓ ${r.name}: PASS`); passed++; }
    else       { console.log(`✗ ${r.name}: FAIL — ${r.err}`); failed++; }
  }
  console.log(`\nSummary: ${passed} PASS, ${failed} FAIL`);
  process.exit(failed > 0 ? 1 : 0);
})();

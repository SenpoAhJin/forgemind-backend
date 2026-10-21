#!/usr/bin/env node
/**
 * M1e Step 6: HTTP Authorization Tests
 * 
 * Tests HTTP endpoints with real Bearer tokens from /auth/login.
 * Tests cases 3, 4, 9, 10, 1H, 15.
 */

import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const API_BASE = `http://localhost:${process.env.PORT || 3000}`;
const TEST_PREFIX = 'M1EHTTP_';

let testUsers = [];
let testItems = [];
let createdTrades = [];
let originalMaxItems = null;

async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// ============================================================================
// Setup
// ============================================================================

async function setup() {
  console.log('\n=== SETUP ===\n');

  // Create test users (all Holder-verified except unverified)
  const users = [
    { email: `${TEST_PREFIX}proposer@test.com`, name: `${TEST_PREFIX}Proposer`, verified: true, holder: true, password: 'TestPass123!' },
    { email: `${TEST_PREFIX}recipient@test.com`, name: `${TEST_PREFIX}Recipient`, verified: true, holder: true, password: 'TestPass456!' },
    { email: `${TEST_PREFIX}thirdparty@test.com`, name: `${TEST_PREFIX}ThirdParty`, verified: true, holder: true, password: 'TestPass789!' },
    { email: `${TEST_PREFIX}unverified@test.com`, name: `${TEST_PREFIX}Unverified`, verified: false, holder: false, password: 'TestPass000!' },
    { email: `${TEST_PREFIX}holder@test.com`, name: `${TEST_PREFIX}Holder`, verified: true, holder: true, password: 'HolderPass111!', isHolder: true },
  ];

  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 12);

    const userRows = await query(
      `INSERT INTO users (email, password_hash, display_name, base_body_selection, is_holder_verified, verification_status, is_cosplayer)
       VALUES ($1, $2, $3, 'male', $4, $5, true)
       RETURNING user_id`,
      [u.email, passwordHash, u.name, u.holder, u.verified ? 'verified' : 'not_submitted']
    );
    const user_id = userRows[0].user_id;

    testUsers.push({
      user_id,
      email: u.email,
      display_name: u.name,
      password: u.password,
      verified: u.verified,
      holder: u.holder,
      isHolder: u.isHolder || false,
      token: null, // Will be filled by login
    });
    console.log(`✓ Created user: ${u.name} (${user_id.substring(0, 8)}...)`);
  }

  // Create items (4 for proposer, 4 for recipient, 2 for third party)
  const proposer = testUsers.find(u => u.email.includes('proposer'));
  const recipient = testUsers.find(u => u.email.includes('recipient'));
  const thirdParty = testUsers.find(u => u.email.includes('thirdparty'));

  for (let i = 0; i < 4; i++) {
    const propItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [proposer.user_id, `${TEST_PREFIX}proposer_item_${i + 1}`]
    );
    testItems.push({ attire_id: propItem[0].attire_id, user_id: proposer.user_id, notes: `proposer_item_${i + 1}` });

    const recItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [recipient.user_id, `${TEST_PREFIX}recipient_item_${i + 1}`]
    );
    testItems.push({ attire_id: recItem[0].attire_id, user_id: recipient.user_id, notes: `recipient_item_${i + 1}` });
  }

  for (let i = 0; i < 2; i++) {
    const thirdItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [thirdParty.user_id, `${TEST_PREFIX}third_item_${i + 1}`]
    );
    testItems.push({ attire_id: thirdItem[0].attire_id, user_id: thirdParty.user_id, notes: `third_item_${i + 1}` });
  }

  console.log(`✓ Created ${testItems.length} test items`);
  console.log('');
}

// ============================================================================
// Login Helper
// ============================================================================

async function loginUser(user) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });

  if (!res.ok) {
    throw new Error(`Login failed for ${user.email}: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  user.token = data.sessionToken;
  console.log(`✓ Logged in: ${user.display_name} (token: ${user.token.substring(0, 16)}...)`);
}

async function loginAllUsers() {
  console.log('=== LOGIN ===\n');
  for (const user of testUsers) {
    await loginUser(user);
  }
  console.log('');
}

// ============================================================================
// Test Cases
// ============================================================================

async function test3_nonPartyGet404() {
  try {
    console.log('TEST 3: Non-party gets 404 for GET /trades/:id');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const thirdParty = testUsers.find(u => u.email.includes('thirdparty'));

    const propItem = testItems.find(i => i.user_id === proposer.user_id && i.notes.includes('item_1'));
    const recItem = testItems.find(i => i.user_id === recipient.user_id && i.notes.includes('item_1'));

    // Proposer creates a trade
    const proposeRes = await fetch(`${API_BASE}/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proposer.token}`,
      },
      body: JSON.stringify({
        recipient_id: recipient.user_id,
        type: 'swap',
        offered_item_ids: [propItem.attire_id],
        requested_item_ids: [recItem.attire_id],
        note: 'Test HTTP trade',
      }),
    });

    if (!proposeRes.ok) {
      throw new Error(`Propose failed: ${proposeRes.status} ${await proposeRes.text()}`);
    }

    const proposeData = await proposeRes.json();
    const tradeId = proposeData.trade_id;
    createdTrades.push(tradeId);
    console.log(`  ✓ Proposed trade ${tradeId.substring(0, 8)}...`);

    // Third party tries to GET trade (should get 404)
    const getRes = await fetch(`${API_BASE}/trades/${tradeId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${thirdParty.token}` },
    });

    if (getRes.status !== 404) {
      throw new Error(`Expected 404, got ${getRes.status}`);
    }

    console.log(`  ✓ Third party GET returned 404`);

    // Third party tries to accept (should get 404 or 403)
    const acceptRes = await fetch(`${API_BASE}/trades/${tradeId}/accept`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${thirdParty.token}` },
    });

    if (acceptRes.status !== 404 && acceptRes.status !== 403) {
      throw new Error(`Expected 404 or 403, got ${acceptRes.status}`);
    }

    console.log(`  ✓ Third party accept returned ${acceptRes.status}`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test4_unverifiedCannotPropose() {
  try {
    console.log('TEST 4: Unverified user cannot propose');

    const unverified = testUsers.find(u => u.email.includes('unverified'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));

    const propItem = testItems.find(i => i.notes.includes('third_item_1'));
    const recItem = testItems.find(i => i.user_id === recipient.user_id && i.notes.includes('item_2'));

    const proposeRes = await fetch(`${API_BASE}/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${unverified.token}`,
      },
      body: JSON.stringify({
        recipient_id: recipient.user_id,
        type: 'swap',
        offered_item_ids: [propItem.attire_id],
        requested_item_ids: [recItem.attire_id],
      }),
    });

    if (proposeRes.ok) {
      throw new Error('Unverified user was able to propose (should have been blocked)');
    }

    if (proposeRes.status !== 400) {
      throw new Error(`Expected 400, got ${proposeRes.status}`);
    }

    const errorData = await proposeRes.json();
    if (!errorData.message || !errorData.message.includes('Holder-verified')) {
      throw new Error(`Expected error about Holder-verified, got: ${errorData.message}`);
    }

    console.log(`  ✓ Unverified user rejected: ${errorData.message}`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test9_holderChangesMaxItems() {
  try {
    console.log('TEST 9: Holder changes trade.max_items_per_side');

    const holder = testUsers.find(u => u.isHolder);
    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));

    // Get current value
    const getRes = await fetch(`${API_BASE}/admin/settings/trade.max_items_per_side`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${holder.token}` },
    });

    if (!getRes.ok) {
      throw new Error(`GET settings failed: ${getRes.status} ${await getRes.text()}`);
    }

    const getData = await getRes.json();
    originalMaxItems = getData.value;
    console.log(`  ✓ Current trade.max_items_per_side: ${originalMaxItems}`);

    // Change to 2
    const putRes = await fetch(`${API_BASE}/admin/settings/trade.max_items_per_side`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${holder.token}`,
      },
      body: JSON.stringify({ value: 2 }),
    });

    if (!putRes.ok) {
      throw new Error(`PUT settings failed: ${putRes.status} ${await putRes.text()}`);
    }

    console.log(`  ✓ Changed to 2`);

    // Try to propose 3 items (should fail)
    const propItems = testItems.filter(i => i.user_id === proposer.user_id).slice(0, 3);
    const recItem = testItems.find(i => i.user_id === recipient.user_id && i.notes.includes('item_3'));

    const proposeRes = await fetch(`${API_BASE}/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proposer.token}`,
      },
      body: JSON.stringify({
        recipient_id: recipient.user_id,
        type: 'swap',
        offered_item_ids: propItems.map(i => i.attire_id),
        requested_item_ids: [recItem.attire_id],
      }),
    });

    if (proposeRes.ok) {
      throw new Error('Proposal with 3 items succeeded (should have failed with limit=2)');
    }

    const errorData = await proposeRes.json();
    if (!errorData.message || !errorData.message.includes('more than 2')) {
      throw new Error(`Expected error about "more than 2", got: ${errorData.message}`);
    }

    console.log(`  ✓ Proposal rejected: ${errorData.message}`);

    // Restore original value
    const restoreRes = await fetch(`${API_BASE}/admin/settings/trade.max_items_per_side`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${holder.token}`,
      },
      body: JSON.stringify({ value: originalMaxItems }),
    });

    if (!restoreRes.ok) {
      throw new Error(`Restore settings failed: ${restoreRes.status}`);
    }

    console.log(`  ✓ Restored to ${originalMaxItems}`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test10_nonHolderCannotChangeSettings() {
  try {
    console.log('TEST 10: Non-Holder gets 403 on GET and PUT /admin/settings');

    const proposer = testUsers.find(u => u.email.includes('proposer'));

    // Try GET
    const getRes = await fetch(`${API_BASE}/admin/settings/trade.max_items_per_side`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${proposer.token}` },
    });

    if (getRes.status !== 403) {
      throw new Error(`GET expected 403, got ${getRes.status}`);
    }

    console.log(`  ✓ Non-Holder GET returned 403`);

    // Try PUT
    const putRes = await fetch(`${API_BASE}/admin/settings/trade.max_items_per_side`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proposer.token}`,
      },
      body: JSON.stringify({ value: 10 }),
    });

    if (putRes.status !== 403) {
      throw new Error(`PUT expected 403, got ${putRes.status}`);
    }

    console.log(`  ✓ Non-Holder PUT returned 403`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test1H_fullSwapOverHTTP() {
  try {
    console.log('TEST 1H: Full happy path swap over HTTP');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));

    const propItem = testItems.find(i => i.user_id === proposer.user_id && i.notes.includes('item_4'));
    const recItem = testItems.find(i => i.user_id === recipient.user_id && i.notes.includes('item_4'));

    // Propose
    const proposeRes = await fetch(`${API_BASE}/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proposer.token}`,
      },
      body: JSON.stringify({
        recipient_id: recipient.user_id,
        type: 'swap',
        offered_item_ids: [propItem.attire_id],
        requested_item_ids: [recItem.attire_id],
      }),
    });

    if (!proposeRes.ok) {
      throw new Error(`Propose failed: ${proposeRes.status} ${await proposeRes.text()}`);
    }

    const proposeData = await proposeRes.json();
    const tradeId = proposeData.trade_id;
    createdTrades.push(tradeId);
    console.log(`  ✓ Proposed trade ${tradeId.substring(0, 8)}...`);

    // Recipient accepts
    const acceptRes = await fetch(`${API_BASE}/trades/${tradeId}/accept`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${recipient.token}` },
    });

    if (!acceptRes.ok) {
      throw new Error(`Accept failed: ${acceptRes.status} ${await acceptRes.text()}`);
    }

    console.log(`  ✓ Recipient accepted`);

    // Both confirm
    const propConfirmRes = await fetch(`${API_BASE}/trades/${tradeId}/confirm`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${proposer.token}` },
    });

    if (!propConfirmRes.ok) {
      throw new Error(`Proposer confirm failed: ${propConfirmRes.status}`);
    }

    console.log(`  ✓ Proposer confirmed`);

    const recConfirmRes = await fetch(`${API_BASE}/trades/${tradeId}/confirm`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${recipient.token}` },
    });

    if (!recConfirmRes.ok) {
      throw new Error(`Recipient confirm failed: ${recConfirmRes.status}`);
    }

    console.log(`  ✓ Recipient confirmed`);

    // Verify ownership transfer
    const items = await query(
      `SELECT attire_id, user_id FROM owned_attire WHERE attire_id = ANY($1::uuid[])`,
      [[propItem.attire_id, recItem.attire_id]]
    );

    const propItemOwner = items.find(i => i.attire_id === propItem.attire_id);
    const recItemOwner = items.find(i => i.attire_id === recItem.attire_id);

    if (propItemOwner.user_id !== recipient.user_id) {
      throw new Error('Proposer item not transferred');
    }

    if (recItemOwner.user_id !== proposer.user_id) {
      throw new Error('Recipient item not transferred');
    }

    console.log(`  ✓ Ownership transferred`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test15_cannotSpoofActorId() {
  try {
    console.log('TEST 15: User cannot pass another user\'s ID as actor');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const thirdParty = testUsers.find(u => u.email.includes('thirdparty'));

    // Create a trade
    const propItem = testItems.find(i => i.user_id === proposer.user_id && i.notes.includes('item_2'));
    const recItem = testItems.find(i => i.user_id === recipient.user_id && i.notes.includes('item_2'));

    const proposeRes = await fetch(`${API_BASE}/trades`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${proposer.token}`,
      },
      body: JSON.stringify({
        recipient_id: recipient.user_id,
        type: 'swap',
        offered_item_ids: [propItem.attire_id],
        requested_item_ids: [recItem.attire_id],
      }),
    });

    if (!proposeRes.ok) {
      throw new Error(`Propose failed: ${proposeRes.status}`);
    }

    const proposeData = await proposeRes.json();
    const tradeId = proposeData.trade_id;
    createdTrades.push(tradeId);
    console.log(`  ✓ Proposed trade ${tradeId.substring(0, 8)}...`);

    // Third party tries to accept with proposer's token but recipient's ID in body (if endpoint allowed actor_id param)
    // NOTE: The current API does NOT have an actor_id parameter - actor always comes from session
    // So this test verifies that recipient token is REQUIRED to accept

    const thirdPartyAcceptRes = await fetch(`${API_BASE}/trades/${tradeId}/accept`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${thirdParty.token}` },
    });

    if (thirdPartyAcceptRes.ok) {
      throw new Error('Third party was able to accept (should have been blocked)');
    }

    if (thirdPartyAcceptRes.status !== 403 && thirdPartyAcceptRes.status !== 404) {
      throw new Error(`Expected 403 or 404, got ${thirdPartyAcceptRes.status}`);
    }

    console.log(`  ✓ Third party accept blocked with ${thirdPartyAcceptRes.status}`);

    // Verify: proposer tries to accept their own trade (should fail - only recipient can accept)
    const proposerAcceptRes = await fetch(`${API_BASE}/trades/${tradeId}/accept`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${proposer.token}` },
    });

    if (proposerAcceptRes.ok) {
      throw new Error('Proposer was able to accept own trade');
    }

    if (proposerAcceptRes.status !== 403) {
      throw new Error(`Expected 403, got ${proposerAcceptRes.status}`);
    }

    console.log(`  ✓ Proposer cannot accept own trade (403)`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup() {
  console.log('\n=== CLEANUP ===\n');

  // Delete trades
  if (createdTrades.length > 0) {
    await query(`DELETE FROM trades WHERE id = ANY($1::uuid[])`, [createdTrades]);
    console.log(`✓ Deleted ${createdTrades.length} test trades`);
  }

  // Delete test items
  if (testItems.length > 0) {
    await query(`DELETE FROM owned_attire WHERE attire_id = ANY($1::uuid[])`, [testItems.map(i => i.attire_id)]);
    console.log(`✓ Deleted ${testItems.length} test items`);
  }

  // Delete test users (cascades sessions)
  if (testUsers.length > 0) {
    await query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [testUsers.map(u => u.user_id)]);
    console.log(`✓ Deleted ${testUsers.length} test users`);
  }

  console.log('');
}

// ============================================================================
// Main
// ============================================================================

(async () => {
  const results = {};

  try {
    await setup();
    await loginAllUsers();

    results['Test 3: Non-party gets 404'] = await test3_nonPartyGet404();
    results['Test 4: Unverified cannot propose'] = await test4_unverifiedCannotPropose();
    results['Test 9: Holder changes max items'] = await test9_holderChangesMaxItems();
    results['Test 10: Non-Holder gets 403'] = await test10_nonHolderCannotChangeSettings();
    results['Test 1H: Full swap over HTTP'] = await test1H_fullSwapOverHTTP();
    results['Test 15: Cannot spoof actor ID'] = await test15_cannotSpoofActorId();

  } catch (err) {
    console.error('\nFATAL ERROR:', err);
  } finally {
    await cleanup();

    console.log('\n=== RESULTS ===\n');
    for (const [name, result] of Object.entries(results)) {
      const icon = result === 'PASS' ? '✓' : result === 'FAIL' ? '✗' : '○';
      console.log(`${icon} ${name}: ${result}`);
    }
    console.log('');

    const passCount = Object.values(results).filter(r => r === 'PASS').length;
    const failCount = Object.values(results).filter(r => r === 'FAIL').length;

    console.log(`Summary: ${passCount} PASS, ${failCount} FAIL\n`);

    await pool.end();
    process.exit(failCount > 0 ? 1 : 0);
  }
})();

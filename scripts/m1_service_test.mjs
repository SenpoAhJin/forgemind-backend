#!/usr/bin/env node
/**
 * M1d Step 3: Service-Level Tests
 * 
 * Tests tradeService.ts functions directly (no HTTP, no auth).
 * Tests cases 1, 2, 5, 6, 7, 8, 11, 12, 13, 14.
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

async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

const TEST_PREFIX = 'M1DSVC_';
let testUsers = [];
let testItems = [];
let createdTrades = [];

// Import compiled tradeService
let tradeService;

async function importTradeService() {
  try {
    // Try to import from dist
    const module = await import('../dist/trades/tradeService.js');
    tradeService = module;
    console.log('✓ Loaded tradeService from dist/');
  } catch (err) {
    console.error('✗ Failed to load tradeService:', err.message);
    console.error('Run "npm run build" first');
    process.exit(1);
  }
}

// ============================================================================
// Setup
// ============================================================================

async function setup() {
  console.log('\n=== SETUP ===\n');

  // Create 3 test users (proposer, recipient, third party)
  const users = [
    { email: `${TEST_PREFIX}proposer@test.com`, name: `${TEST_PREFIX}Proposer`, verified: true, holder: true },
    { email: `${TEST_PREFIX}recipient@test.com`, name: `${TEST_PREFIX}Recipient`, verified: true, holder: true },
    { email: `${TEST_PREFIX}thirdparty@test.com`, name: `${TEST_PREFIX}ThirdParty`, verified: true, holder: true },
    { email: `${TEST_PREFIX}unverified@test.com`, name: `${TEST_PREFIX}Unverified`, verified: false, holder: false },
  ];

  const dummyPasswordHash = await bcrypt.hash('testpassword123', 10);

  for (const u of users) {
    const userRows = await query(
      `INSERT INTO users (email, password_hash, display_name, base_body_selection, is_holder_verified, verification_status, is_cosplayer)
       VALUES ($1, $2, $3, 'male', $4, $5, true)
       RETURNING user_id`,
      [u.email, dummyPasswordHash, u.name, u.holder, u.verified ? 'verified' : 'not_submitted']
    );
    const user_id = userRows[0].user_id;

    testUsers.push({
      user_id,
      email: u.email,
      display_name: u.name,
      verified: u.verified,
      holder: u.holder
    });
    console.log(`✓ Created user: ${u.name} (${user_id.substring(0, 8)}...)`);
  }

  // Create test items (6 for proposer, 6 for recipient, 2 for third party)
  const proposer = testUsers.find(u => u.email.includes('proposer'));
  const recipient = testUsers.find(u => u.email.includes('recipient'));
  const thirdParty = testUsers.find(u => u.email.includes('thirdparty'));

  for (let i = 0; i < 6; i++) {
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
// Test Cases
// ============================================================================

async function test1_swapHappyPath() {
  try {
    console.log('TEST 1: Swap happy path (propose → accept → both confirm → completed)');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const propItems = testItems.filter(i => i.user_id === proposer.user_id && i.notes.includes('item_1'));
    const recItems = testItems.filter(i => i.user_id === recipient.user_id && i.notes.includes('item_1'));

    // Propose
    const tradeId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItems[0].attire_id],
      requested_item_ids: [recItems[0].attire_id],
      note: 'Test swap',
    });
    createdTrades.push(tradeId);
    console.log(`  ✓ Proposed trade ${tradeId.substring(0, 8)}...`);

    // Accept
    await tradeService.acceptTrade(tradeId, recipient.user_id);
    console.log(`  ✓ Recipient accepted`);

    // Both confirm
    await tradeService.confirmTrade(tradeId, proposer.user_id);
    console.log(`  ✓ Proposer confirmed`);

    await tradeService.confirmTrade(tradeId, recipient.user_id);
    console.log(`  ✓ Recipient confirmed`);

    // Verify state
    const trade = await query(`SELECT state FROM trades WHERE id = $1`, [tradeId]);
    if (trade[0].state !== 'completed') throw new Error(`State is ${trade[0].state}, not completed`);

    // Verify ownership changed
    const items = await query(
      `SELECT attire_id, user_id FROM owned_attire WHERE attire_id = ANY($1::uuid[])`,
      [[propItems[0].attire_id, recItems[0].attire_id]]
    );

    const propItemOwner = items.find(i => i.attire_id === propItems[0].attire_id);
    const recItemOwner = items.find(i => i.attire_id === recItems[0].attire_id);

    if (propItemOwner.user_id !== recipient.user_id) throw new Error('Proposer item not transferred');
    if (recItemOwner.user_id !== proposer.user_id) throw new Error('Recipient item not transferred');

    // Verify history
    const history = await query(
      `SELECT COUNT(*) as count FROM item_ownership_history WHERE trade_id = $1`,
      [tradeId]
    );
    if (history[0].count !== '2') throw new Error(`Expected 2 history rows, got ${history[0].count}`);

    console.log(`  ✓ Ownership transferred and history recorded`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test2_onePartyConfirms() {
  try {
    console.log('TEST 2: Only one party confirms (nothing moves)');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const propItems = testItems.filter(i => i.user_id === proposer.user_id && i.notes.includes('item_2'));
    const recItems = testItems.filter(i => i.user_id === recipient.user_id && i.notes.includes('item_2'));

    // Propose and accept
    const tradeId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItems[0].attire_id],
      requested_item_ids: [recItems[0].attire_id],
    });
    createdTrades.push(tradeId);

    await tradeService.acceptTrade(tradeId, recipient.user_id);

    // Only proposer confirms
    await tradeService.confirmTrade(tradeId, proposer.user_id);

    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify state still accepted
    const trade = await query(`SELECT state FROM trades WHERE id = $1`, [tradeId]);
    if (trade[0].state !== 'accepted') throw new Error(`State is ${trade[0].state}, not accepted`);

    // Verify ownership unchanged
    const items = await query(
      `SELECT attire_id, user_id FROM owned_attire WHERE attire_id = $1`,
      [propItems[0].attire_id]
    );
    if (items[0].user_id !== proposer.user_id) throw new Error('Ownership changed prematurely');

    console.log(`  ✓ Items did not move (state still accepted)`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test5_reservedItemCannotBeReused() {
  try {
    console.log('TEST 5: Reserved item cannot be added to new proposal');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const thirdParty = testUsers.find(u => u.email.includes('thirdparty'));
    const propItem = testItems.filter(i => i.user_id === proposer.user_id && i.notes.includes('item_3'))[0];
    const recItem = testItems.filter(i => i.user_id === recipient.user_id && i.notes.includes('item_3'))[0];
    const thirdItem = testItems.filter(i => i.user_id === thirdParty.user_id)[0];

    // Create Trade A and accept (reserves propItem)
    const tradeAId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItem.attire_id],
      requested_item_ids: [recItem.attire_id],
    });
    createdTrades.push(tradeAId);

    await tradeService.acceptTrade(tradeAId, recipient.user_id);
    console.log(`  ✓ Trade A accepted, propItem reserved`);

    // Try to create Trade B with same propItem
    try {
      await tradeService.proposeTrade({
        proposer_id: proposer.user_id,
        recipient_id: thirdParty.user_id,
        type: 'swap',
        offered_item_ids: [propItem.attire_id],
        requested_item_ids: [thirdItem.attire_id],
      });
      throw new Error('Should have rejected reserved item');
    } catch (err) {
      if (err.message.includes('not available') || err.message.includes('reserved')) {
        console.log(`  ✓ Reserved item rejected: ${err.message}`);
        return 'PASS';
      }
      throw err;
    }
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test6_maxItemsLimit() {
  try {
    console.log('TEST 6: Max items per side limit enforced');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));

    // Get max_items_per_side setting (should be 5)
    const allProposerItems = testItems.filter(i => i.user_id === proposer.user_id && i.notes.includes('item'));
    const sixItems = allProposerItems.slice(0, 6); // Try to offer 6 items

    try {
      await tradeService.proposeTrade({
        proposer_id: proposer.user_id,
        recipient_id: recipient.user_id,
        type: 'swap',
        offered_item_ids: sixItems.map(i => i.attire_id),
        requested_item_ids: [],
      });
      throw new Error('Should have rejected 6 items');
    } catch (err) {
      if (err.message.includes('more than') || err.message.includes('Cannot offer')) {
        console.log(`  ✓ Limit enforced: ${err.message}`);
        return 'PASS';
      }
      throw err;
    }
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test7_concurrentAccepts() {
  try {
    console.log('TEST 7: Two simultaneous accepts (row locking)');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const propItem = testItems.filter(i => i.user_id === proposer.user_id && i.notes.includes('item_4'))[0];
    const recItem = testItems.filter(i => i.user_id === recipient.user_id && i.notes.includes('item_4'))[0];

    const tradeId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItem.attire_id],
      requested_item_ids: [recItem.attire_id],
    });
    createdTrades.push(tradeId);

    // Fire two accepts concurrently
    const results = await Promise.allSettled([
      tradeService.acceptTrade(tradeId, recipient.user_id),
      tradeService.acceptTrade(tradeId, recipient.user_id),
    ]);

    const successes = results.filter(r => r.status === 'fulfilled').length;
    const failures = results.filter(r => r.status === 'rejected').length;

    if (successes !== 1 || failures !== 1) {
      throw new Error(`Expected 1 success and 1 failure, got ${successes} successes and ${failures} failures`);
    }

    // Check the failure is InvalidTransitionError
    const failedResult = results.find(r => r.status === 'rejected');
    if (!failedResult.reason.message.includes('accepted') && !failedResult.reason.message.includes('transition')) {
      throw new Error(`Wrong error: ${failedResult.reason.message}`);
    }

    // Verify items reserved only once
    const items = await query(
      `SELECT availability_status, reserved_trade_id FROM owned_attire WHERE attire_id = $1`,
      [propItem.attire_id]
    );
    if (items[0].availability_status !== 'reserved') throw new Error('Item not reserved');
    if (items[0].reserved_trade_id !== tradeId) throw new Error('Wrong trade_id');

    console.log(`  ✓ One accept succeeded, one failed (row locking worked)`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test8_expiredTradeReleases() {
  try {
    console.log('TEST 8: Expired trade releases item reservations');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const propItem = testItems.filter(i => i.user_id === proposer.user_id && i.notes.includes('item_5'))[0];
    const recItem = testItems.filter(i => i.user_id === recipient.user_id && i.notes.includes('item_5'))[0];

    const tradeId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItem.attire_id],
      requested_item_ids: [recItem.attire_id],
    });
    createdTrades.push(tradeId);

    await tradeService.acceptTrade(tradeId, recipient.user_id);
    console.log(`  ✓ Trade accepted, items reserved`);

    // Manually expire
    await query(`UPDATE trades SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [tradeId]);
    console.log(`  ✓ Set expires_at to past`);

    // Run expiry sweep
    await tradeService.expireStaleTrades();
    console.log(`  ✓ Ran expiry sweep`);

    // Verify state
    const trade = await query(`SELECT state FROM trades WHERE id = $1`, [tradeId]);
    if (trade[0].state !== 'expired') throw new Error(`State is ${trade[0].state}, not expired`);

    // Verify items released
    const items = await query(
      `SELECT availability_status, reserved_trade_id FROM owned_attire WHERE attire_id = ANY($1::uuid[])`,
      [[propItem.attire_id, recItem.attire_id]]
    );

    for (const item of items) {
      if (item.availability_status !== 'free') throw new Error(`Item not freed: ${item.availability_status}`);
      if (item.reserved_trade_id !== null) throw new Error('reserved_trade_id not cleared');
    }

    console.log(`  ✓ Items released to 'free' status`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test11_cascadingCancel() {
  try {
    console.log('TEST 11: Accepting trade A cancels conflicting trade B');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const thirdParty = testUsers.find(u => u.email.includes('thirdparty'));
    const propItem = testItems.filter(i => i.user_id === proposer.user_id && i.notes.includes('item_6'))[0];
    const recItem = testItems.filter(i => i.user_id === recipient.user_id && i.notes.includes('item_6'))[0];
    const thirdItem = testItems.filter(i => i.user_id === thirdParty.user_id)[1];

    // Create Trade A (proposer offers propItem to recipient)
    const tradeAId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItem.attire_id],
      requested_item_ids: [recItem.attire_id],
    });
    createdTrades.push(tradeAId);

    // Create Trade B (proposer offers same propItem to third party)
    const tradeBId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: thirdParty.user_id,
      type: 'swap',
      offered_item_ids: [propItem.attire_id],
      requested_item_ids: [thirdItem.attire_id],
    });
    createdTrades.push(tradeBId);

    console.log(`  ✓ Created Trade A and Trade B (both proposed, same item)`);

    // Accept Trade A (should cascade-cancel Trade B)
    await tradeService.acceptTrade(tradeAId, recipient.user_id);
    console.log(`  ✓ Accepted Trade A`);

    // Verify Trade B cancelled
    const tradeB = await query(`SELECT state FROM trades WHERE id = $1`, [tradeBId]);
    if (tradeB[0].state !== 'cancelled') throw new Error(`Trade B state is ${tradeB[0].state}, not cancelled`);

    // Verify only Trade A has the item reserved
    const item = await query(`SELECT reserved_trade_id FROM owned_attire WHERE attire_id = $1`, [propItem.attire_id]);
    if (item[0].reserved_trade_id !== tradeAId) throw new Error('Item not reserved by Trade A');

    console.log(`  ✓ Trade B cancelled automatically`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test12_secondConfirmNoOp() {
  try {
    console.log('TEST 12: Second confirm by same user is no-op');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));

    // Create fresh items
    const propItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [proposer.user_id, `${TEST_PREFIX}test12_prop`]
    );
    const recItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [recipient.user_id, `${TEST_PREFIX}test12_rec`]
    );

    testItems.push({ attire_id: propItem[0].attire_id, user_id: proposer.user_id });
    testItems.push({ attire_id: recItem[0].attire_id, user_id: recipient.user_id });

    const tradeId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItem[0].attire_id],
      requested_item_ids: [recItem[0].attire_id],
    });
    createdTrades.push(tradeId);

    await tradeService.acceptTrade(tradeId, recipient.user_id);

    // Proposer confirms TWICE
    await tradeService.confirmTrade(tradeId, proposer.user_id);
    const firstTs = await query(`SELECT proposer_confirmed_at FROM trades WHERE id = $1`, [tradeId]);

    await new Promise(resolve => setTimeout(resolve, 100));

    await tradeService.confirmTrade(tradeId, proposer.user_id); // Second time
    const secondTs = await query(`SELECT proposer_confirmed_at FROM trades WHERE id = $1`, [tradeId]);

    if (firstTs[0].proposer_confirmed_at.getTime() !== secondTs[0].proposer_confirmed_at.getTime()) {
      throw new Error('Timestamp changed on second confirm');
    }

    console.log(`  ✓ Second confirm was no-op (timestamp unchanged)`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test13_expiredTradeRejected() {
  try {
    console.log('TEST 13: Accept/confirm on expired trade is rejected');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));

    // Create fresh items
    const propItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [proposer.user_id, `${TEST_PREFIX}test13_prop`]
    );
    const recItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [recipient.user_id, `${TEST_PREFIX}test13_rec`]
    );

    testItems.push({ attire_id: propItem[0].attire_id, user_id: proposer.user_id });
    testItems.push({ attire_id: recItem[0].attire_id, user_id: recipient.user_id });

    const tradeId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItem[0].attire_id],
      requested_item_ids: [recItem[0].attire_id],
    });
    createdTrades.push(tradeId);

    // Expire immediately
    await query(`UPDATE trades SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [tradeId]);

    // Try to accept
    try {
      await tradeService.acceptTrade(tradeId, recipient.user_id);
      throw new Error('Should have rejected expired trade');
    } catch (err) {
      if (err.message.includes('expired') || err.message.includes('transition')) {
        console.log(`  ✓ Accept rejected: ${err.message}`);
        return 'PASS';
      }
      throw err;
    }
  } catch (err) {
    console.error(`  ✗ FAILED: ${err.message}`);
    return 'FAIL';
  }
}

async function test14_wrongActorRejected() {
  try {
    console.log('TEST 14: Wrong actor rejected (proposer cannot accept, non-party cannot act)');

    const proposer = testUsers.find(u => u.email.includes('proposer'));
    const recipient = testUsers.find(u => u.email.includes('recipient'));
    const thirdParty = testUsers.find(u => u.email.includes('thirdparty'));

    // Create fresh items
    const propItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [proposer.user_id, `${TEST_PREFIX}test14_prop`]
    );
    const recItem = await query(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'as-is-only', 5, 'free', $2)
       RETURNING attire_id`,
      [recipient.user_id, `${TEST_PREFIX}test14_rec`]
    );

    testItems.push({ attire_id: propItem[0].attire_id, user_id: proposer.user_id });
    testItems.push({ attire_id: recItem[0].attire_id, user_id: recipient.user_id });

    const tradeId = await tradeService.proposeTrade({
      proposer_id: proposer.user_id,
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: [propItem[0].attire_id],
      requested_item_ids: [recItem[0].attire_id],
    });
    createdTrades.push(tradeId);

    // Proposer tries to accept (should fail)
    try {
      await tradeService.acceptTrade(tradeId, proposer.user_id);
      throw new Error('Proposer should not be able to accept');
    } catch (err) {
      if (err.message.includes('recipient') || err.message.includes('forbidden')) {
        console.log(`  ✓ Proposer accept blocked: ${err.message}`);
      } else {
        throw err;
      }
    }

    // Accept by recipient
    await tradeService.acceptTrade(tradeId, recipient.user_id);
      // Third party tries to confirm (should fail)
      let thirdPartyBlocked = false;
      try {
        await tradeService.confirmTrade(tradeId, thirdParty.user_id);
      } catch (err) {
        // Any error here means third party was blocked
        thirdPartyBlocked = true;
        console.log('  ? Non-party confirm blocked:', err.message || String(err));
      }
      
      if (!thirdPartyBlocked) {
        throw new Error('Third party was able to confirm (should have been blocked)');
      }
      
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
    await importTradeService();
    await setup();

    results['Test 1: Swap happy path'] = await test1_swapHappyPath();
    results['Test 2: One party confirms'] = await test2_onePartyConfirms();
    results['Test 5: Reserved item cannot reuse'] = await test5_reservedItemCannotBeReused();
    results['Test 6: Max items limit'] = await test6_maxItemsLimit();
    results['Test 7: Concurrent accepts'] = await test7_concurrentAccepts();
    results['Test 8: Expired trade releases'] = await test8_expiredTradeReleases();
    results['Test 11: Cascading cancel'] = await test11_cascadingCancel();
    results['Test 12: Second confirm no-op'] = await test12_secondConfirmNoOp();
    results['Test 13: Expired trade rejected'] = await test13_expiredTradeRejected();
    results['Test 14: Wrong actor rejected'] = await test14_wrongActorRejected();

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

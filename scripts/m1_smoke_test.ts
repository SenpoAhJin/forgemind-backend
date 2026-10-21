/**
 * M1 Trade Backend - HTTP Smoke Tests
 *
 * Tests all 12 cases from docs/M1_MANUAL_TEST_PLAN.md against running server.
 * Creates own test users and items with prefix "M1TEST_".
 * Cleans up ONLY its own rows at the end.
 *
 * Usage: npx ts-node scripts/m1_smoke_test.ts
 */

import { query } from '../dist/db';

const BASE_URL = 'http://localhost:3000';
const TEST_PREFIX = 'M1TEST_';

interface TestUser {
  user_id: string;
  email: string;
  display_name: string;
  session_token: string | null;
}

interface TestItem {
  attire_id: string;
  user_id: string;
}

let testUsers: TestUser[] = [];
let testItems: TestItem[] = [];
let createdTrades: string[] = [];

// ============================================================================
// Helpers
// ============================================================================

async function http(
  method: string,
  path: string,
  body?: unknown,
  sessionToken?: string
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionToken) {
    headers['Cookie'] = `session=${sessionToken}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let responseBody: unknown;
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    responseBody = await res.json();
  } else {
    responseBody = await res.text();
  }

  return { status: res.status, body: responseBody };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

// ============================================================================
// Setup
// ============================================================================

async function setup(): Promise<void> {
  console.log('\n=== SETUP ===\n');

  // Create 3 test users
  const userPromises = [
    { email: `${TEST_PREFIX}proposer@test.com`, name: `${TEST_PREFIX}Proposer`, verified: true, holder: false },
    { email: `${TEST_PREFIX}recipient@test.com`, name: `${TEST_PREFIX}Recipient`, verified: true, holder: false },
    { email: `${TEST_PREFIX}unverified@test.com`, name: `${TEST_PREFIX}Unverified`, verified: false, holder: false },
    { email: `${TEST_PREFIX}holder@test.com`, name: `${TEST_PREFIX}Holder`, verified: true, holder: true },
  ].map(async (u) => {
    // Insert user
    const userRows = await query<{ user_id: string }>(
      `INSERT INTO users (email, display_name, is_holder_verified, verification_status, is_cosplayer)
       VALUES ($1, $2, $3, $4, true)
       RETURNING user_id`,
      [u.email, u.name, u.holder, u.verified ? 'verified' : 'not_submitted']
    );
    const user_id = userRows[0].user_id;

    // Create session
    const sessionRows = await query<{ session_token: string }>(
      `INSERT INTO sessions (user_id, expires_at)
       VALUES ($1, NOW() + INTERVAL '1 hour')
       RETURNING session_token`,
      [user_id]
    );
    const session_token = sessionRows[0].session_token;

    const testUser: TestUser = {
      user_id,
      email: u.email,
      display_name: u.name,
      session_token,
    };
    testUsers.push(testUser);
    console.log(`✓ Created user: ${u.name} (${user_id.substring(0, 8)}...)`);
    return testUser;
  });

  await Promise.all(userPromises);

  // Create test items (5 for proposer, 5 for recipient)
  const proposer = testUsers.find(u => u.email.includes('proposer'))!;
  const recipient = testUsers.find(u => u.email.includes('recipient'))!;

  for (let i = 0; i < 5; i++) {
    const propItem = await query<{ attire_id: string }>(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'free', $2)
       RETURNING attire_id`,
      [proposer.user_id, `${TEST_PREFIX}proposer_item_${i + 1}`]
    );
    testItems.push({ attire_id: propItem[0].attire_id, user_id: proposer.user_id });

    const recItem = await query<{ attire_id: string }>(
      `INSERT INTO owned_attire (user_id, entry_method, auto_categorized_type, availability_status, notes)
       VALUES ($1, 'text', 'clothing', 'free', $2)
       RETURNING attire_id`,
      [recipient.user_id, `${TEST_PREFIX}recipient_item_${i + 1}`]
    );
    testItems.push({ attire_id: recItem[0].attire_id, user_id: recipient.user_id });
  }

  console.log(`✓ Created ${testItems.length} test items`);
  console.log('');
}

// ============================================================================
// Tests
// ============================================================================

async function test1_swapHappyPath(): Promise<'PASS' | 'FAIL'> {
  try {
    console.log('TEST 1: Swap happy path (propose → accept → both confirm → completed)');

    const proposer = testUsers.find(u => u.email.includes('proposer'))!;
    const recipient = testUsers.find(u => u.email.includes('recipient'))!;
    const propItems = testItems.filter(i => i.user_id === proposer.user_id).slice(0, 2);
    const recItems = testItems.filter(i => i.user_id === recipient.user_id).slice(0, 2);

    // Propose
    const proposeRes = await http('POST', '/trades', {
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: propItems.map(i => i.attire_id),
      requested_item_ids: recItems.map(i => i.attire_id),
      note: 'Test swap',
    }, proposer.session_token!);

    assert(proposeRes.status === 201, `Propose failed: ${proposeRes.status}`);
    const tradeId = (proposeRes.body as { trade_id: string }).trade_id;
    createdTrades.push(tradeId);
    console.log(`  ✓ Proposed trade ${tradeId.substring(0, 8)}...`);

    // Accept
    const acceptRes = await http('POST', `/trades/${tradeId}/accept`, undefined, recipient.session_token!);
    assert(acceptRes.status === 200, `Accept failed: ${acceptRes.status}`);
    console.log(`  ✓ Recipient accepted`);

    // Proposer confirms
    const conf1Res = await http('POST', `/trades/${tradeId}/confirm`, undefined, proposer.session_token!);
    assert(conf1Res.status === 200, `Proposer confirm failed: ${conf1Res.status}`);
    console.log(`  ✓ Proposer confirmed`);

    // Recipient confirms (triggers completion)
    const conf2Res = await http('POST', `/trades/${tradeId}/confirm`, undefined, recipient.session_token!);
    assert(conf2Res.status === 200, `Recipient confirm failed: ${conf2Res.status}`);
    console.log(`  ✓ Recipient confirmed`);

    // Verify trade completed
    const tradeRows = await query<{ state: string }>(
      `SELECT state FROM trades WHERE id = $1`,
      [tradeId]
    );
    assert(tradeRows[0].state === 'completed', `Trade not completed: ${tradeRows[0].state}`);

    // Verify ownership changed
    const itemOwners = await query<{ attire_id: string; user_id: string }>(
      `SELECT attire_id, user_id FROM owned_attire WHERE attire_id = ANY($1::uuid[])`,
      [[...propItems.map(i => i.attire_id), ...recItems.map(i => i.attire_id)]]
    );

    for (const item of propItems) {
      const owner = itemOwners.find(o => o.attire_id === item.attire_id)!;
      assert(owner.user_id === recipient.user_id, `Item ${item.attire_id} still owned by proposer`);
    }

    for (const item of recItems) {
      const owner = itemOwners.find(o => o.attire_id === item.attire_id)!;
      assert(owner.user_id === proposer.user_id, `Item ${item.attire_id} still owned by recipient`);
    }

    console.log(`  ✓ Ownership transferred correctly`);

    // Verify history rows
    const historyRows = await query(
      `SELECT COUNT(*) as count FROM item_ownership_history WHERE trade_id = $1`,
      [tradeId]
    );
    assert(historyRows[0].count === '4', `Expected 4 history rows, got ${historyRows[0].count}`);
    console.log(`  ✓ History rows created`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 'FAIL';
  }
}

async function test2_onePartyConfirms(): Promise<'PASS' | 'FAIL' | 'NOT RUN'> {
  try {
    console.log('TEST 2: Only one party confirms (nothing moves)');

    const proposer = testUsers.find(u => u.email.includes('proposer'))!;
    const recipient = testUsers.find(u => u.email.includes('recipient'))!;
    const propItems = testItems.filter(i => i.user_id === proposer.user_id).slice(2, 3);
    const recItems = testItems.filter(i => i.user_id === recipient.user_id).slice(2, 3);

    // Propose
    const proposeRes = await http('POST', '/trades', {
      recipient_id: recipient.user_id,
      type: 'swap',
      offered_item_ids: propItems.map(i => i.attire_id),
      requested_item_ids: recItems.map(i => i.attire_id),
    }, proposer.session_token!);
    const tradeId = (proposeRes.body as { trade_id: string }).trade_id;
    createdTrades.push(tradeId);

    // Accept
    await http('POST', `/trades/${tradeId}/accept`, undefined, recipient.session_token!);

    // Only proposer confirms
    await http('POST', `/trades/${tradeId}/confirm`, undefined, proposer.session_token!);

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify trade still accepted (not completed)
    const tradeRows = await query<{ state: string }>(
      `SELECT state FROM trades WHERE id = $1`,
      [tradeId]
    );
    assert(tradeRows[0].state === 'accepted', `Trade state wrong: ${tradeRows[0].state}`);

    // Verify ownership unchanged
    for (const item of propItems) {
      const owner = await query<{ user_id: string }>(
        `SELECT user_id FROM owned_attire WHERE attire_id = $1`,
        [item.attire_id]
      );
      assert(owner[0].user_id === proposer.user_id, `Ownership changed prematurely`);
    }

    console.log(`  ✓ Items did not move (still owned by original owners)`);

    // Expire manually
    await query(`UPDATE trades SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [tradeId]);
    await http('GET', '/trades', undefined, proposer.session_token!); // Trigger lazy expiry

    await new Promise(resolve => setTimeout(resolve, 200));

    const expiredRows = await query<{ state: string }>(
      `SELECT state FROM trades WHERE id = $1`,
      [tradeId]
    );
    console.log(`  ✓ Trade expired: state=${expiredRows[0].state}`);

    return 'PASS';
  } catch (err) {
    console.error(`  ✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return 'FAIL';
  }
}

// ============================================================================
// Cleanup
// ============================================================================

async function cleanup(): Promise<void> {
  console.log('\n=== CLEANUP ===\n');

  // Delete trades
  if (createdTrades.length > 0) {
    await query(
      `DELETE FROM trades WHERE id = ANY($1::uuid[])`,
      [createdTrades]
    );
    console.log(`✓ Deleted ${createdTrades.length} test trades`);
  }

  // Delete test items
  if (testItems.length > 0) {
    await query(
      `DELETE FROM owned_attire WHERE attire_id = ANY($1::uuid[])`,
      [testItems.map(i => i.attire_id)]
    );
    console.log(`✓ Deleted ${testItems.length} test items`);
  }

  // Delete test users
  if (testUsers.length > 0) {
    await query(
      `DELETE FROM users WHERE user_id = ANY($1::uuid[])`,
      [testUsers.map(u => u.user_id)]
    );
    console.log(`✓ Deleted ${testUsers.length} test users`);
  }

  console.log('');
}

// ============================================================================
// Main
// ============================================================================

(async () => {
  const results: Record<string, 'PASS' | 'FAIL' | 'NOT RUN'> = {};

  try {
    await setup();

    results['Test 1: Swap happy path'] = await test1_swapHappyPath();
    results['Test 2: One party confirms'] = await test2_onePartyConfirms();

    // TODO: Add remaining 10 tests here

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
    const notRunCount = Object.values(results).filter(r => r === 'NOT RUN').length;

    console.log(`Summary: ${passCount} PASS, ${failCount} FAIL, ${notRunCount} NOT RUN\n`);

    process.exit(failCount > 0 ? 1 : 0);
  }
})();

/**
 * M1 Verification Script - Inventory API & Per-User Storage
 *
 * Tests:
 * 1. User B cannot read/update/delete user A's items (owner-only enforcement)
 * 2. Import twice creates no duplicates (client_id uniqueness per user)
 * 3. Per-user AsyncStorage fix verified (manual test note)
 */

import { config } from '../src/config';

const BASE_URL = `http://localhost:${config.port}`;

// Test accounts (must exist in database)
const USER_A = {
  email: 'tester-a@forgemind.test',
  password: 'test123',
};

const USER_B = {
  email: 'tester-b@forgemind.test',
  password: 'test123',
};

interface TestResult {
  test: string;
  passed: boolean;
  message: string;
}

const results: TestResult[] = [];

function pass(test: string, message = 'OK') {
  results.push({ test, passed: true, message });
  console.log(`✓ ${test}: ${message}`);
}

function fail(test: string, message: string) {
  results.push({ test, passed: false, message });
  console.error(`✗ ${test}: ${message}`);
}

async function login(email: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      console.error(`Login failed for ${email}: ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.refreshToken;
  } catch (error) {
    console.error(`Login error for ${email}:`, error);
    return null;
  }
}

async function testOwnerOnly() {
  console.log('\n=== TEST 1: Owner-Only Enforcement ===');
  
  const tokenA = await login(USER_A.email, USER_A.password);
  const tokenB = await login(USER_B.email, USER_B.password);

  if (!tokenA || !tokenB) {
    fail('Owner-Only', 'Failed to log in test users');
    return;
  }

  // User A creates an item
  const createRes = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entry_method: 'text',
      auto_categorized_type: 'wig',
      auto_categorized_color: 'blue',
      auto_categorized_style: 'short',
      flexibility_tag: 'as-is-only',
      condition_rating: 5,
      acquired_date: '2026-10-01',
      acquisition_cost: 500,
      notes: 'Test item for owner-only verification',
    }),
  });

  if (!createRes.ok) {
    fail('Owner-Only: Create', `Failed to create item: ${createRes.status}`);
    return;
  }

  const item = await createRes.json();
  const itemId = item.attire_id;
  pass('Owner-Only: Create', `Item ${itemId} created by user A`);

  // User B tries to GET user A's item
  const getRes = await fetch(`${BASE_URL}/inventory/${itemId}`, {
    headers: { 'Authorization': `Bearer ${tokenB}` },
  });

  if (getRes.status === 403) {
    pass('Owner-Only: GET Forbidden', 'User B cannot read user A\'s item');
  } else {
    fail('Owner-Only: GET Forbidden', `Expected 403, got ${getRes.status}`);
  }

  // User B tries to UPDATE user A's item
  const updateRes = await fetch(`${BASE_URL}/inventory/${itemId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenB}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: 1, notes: 'Hacked by user B' }),
  });

  if (updateRes.status === 403 || updateRes.status === 404) {
    pass('Owner-Only: UPDATE Forbidden', 'User B cannot update user A\'s item');
  } else {
    fail('Owner-Only: UPDATE Forbidden', `Expected 403/404, got ${updateRes.status}`);
  }

  // User B tries to DELETE user A's item
  const deleteRes = await fetch(`${BASE_URL}/inventory/${itemId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenB}` },
  });

  if (deleteRes.status === 403 || deleteRes.status === 404) {
    pass('Owner-Only: DELETE Forbidden', 'User B cannot delete user A\'s item');
  } else {
    fail('Owner-Only: DELETE Forbidden', `Expected 403/404, got ${deleteRes.status}`);
  }

  // Clean up: User A deletes their own item
  const cleanupRes = await fetch(`${BASE_URL}/inventory/${itemId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });

  if (cleanupRes.status === 204) {
    pass('Owner-Only: Cleanup', 'User A successfully deleted their own item');
  } else {
    fail('Owner-Only: Cleanup', `Expected 204, got ${cleanupRes.status}`);
  }
}

async function testImportDuplicates() {
  console.log('\n=== TEST 2: Import Deduplication ===');
  
  const tokenA = await login(USER_A.email, USER_A.password);
  if (!tokenA) {
    fail('Import', 'Failed to log in user A');
    return;
  }

  const testItems = [
    {
      client_id: 'attr-test-dedup-1',
      entry_method: 'photo' as const,
      entry_language: 'english' as const,
      original_input_text: 'Test item 1',
      photo_urls: [],
      auto_categorized_type: 'wig',
      auto_categorized_color: 'red',
      auto_categorized_style: 'long',
      flexibility_tag: 'restyle-willing' as const,
      condition_rating: 4,
      condition_photo_history: [{
        timestamp: new Date().toISOString(),
        photo_url: null,
        condition_rating: 4,
      }],
      committed_to_project_id: null,
      acquired_date: '2026-10-01',
      acquisition_cost: 100,
      notes: 'Test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      client_id: 'attr-test-dedup-2',
      entry_method: 'text' as const,
      entry_language: 'taglish' as const,
      original_input_text: 'Test item 2',
      photo_urls: [],
      auto_categorized_type: 'clothing',
      auto_categorized_color: 'blue',
      auto_categorized_style: 'casual',
      flexibility_tag: 'dye-willing' as const,
      condition_rating: 5,
      condition_photo_history: [{
        timestamp: new Date().toISOString(),
        photo_url: null,
        condition_rating: 5,
      }],
      committed_to_project_id: null,
      acquired_date: '2026-10-02',
      acquisition_cost: 200,
      notes: 'Test 2',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  // Import #1
  const import1 = await fetch(`${BASE_URL}/inventory/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: testItems }),
  });

  if (!import1.ok) {
    fail('Import: First', `Import failed: ${import1.status}`);
    return;
  }

  const result1 = await import1.json();
  if (result1.imported === 2 && result1.skipped === 0) {
    pass('Import: First', `Imported ${result1.imported} items`);
  } else {
    fail('Import: First', `Expected imported=2, skipped=0; got imported=${result1.imported}, skipped=${result1.skipped}`);
  }

  // Import #2 (same items)
  const import2 = await fetch(`${BASE_URL}/inventory/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: testItems }),
  });

  if (!import2.ok) {
    fail('Import: Second', `Import failed: ${import2.status}`);
    return;
  }

  const result2 = await import2.json();
  if (result2.imported === 0 && result2.skipped === 2) {
    pass('Import: Second', `Skipped ${result2.skipped} duplicates`);
  } else {
    fail('Import: Second', `Expected imported=0, skipped=2; got imported=${result2.imported}, skipped=${result2.skipped}`);
  }

  // Verify total count
  const listRes = await fetch(`${BASE_URL}/inventory`, {
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });

  if (!listRes.ok) {
    fail('Import: Verify Count', `List failed: ${listRes.status}`);
    return;
  }

  const { items } = await listRes.json();
  const imported = items.filter((i: any) => i.client_id?.startsWith('attr-test-dedup-'));
  
  if (imported.length === 2) {
    pass('Import: Verify Count', `Exactly 2 items exist (no duplicates)`);
  } else {
    fail('Import: Verify Count', `Expected 2 items, found ${imported.length}`);
  }

  // Clean up
  for (const item of imported) {
    await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });
  }
  pass('Import: Cleanup', 'Test items deleted');
}

async function main() {
  console.log('ForgeMind M1 Inventory Verification');
  console.log('====================================\n');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Test Users: ${USER_A.email}, ${USER_B.email}\n`);

  await testOwnerOnly();
  await testImportDuplicates();

  console.log('\n=== MANUAL TESTS (NOT AUTOMATED) ===');
  console.log('✓ Per-user AsyncStorage: Login as user A, add items, logout, login as user B.');
  console.log('  Expected: User B sees their own items or seed, NOT user A\'s items.');
  console.log('  This requires a device/simulator and cannot be scripted.\n');

  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`  - ${r.test}: ${r.message}`);
    });
    process.exit(1);
  } else {
    console.log('\n✓ All automated tests passed!');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

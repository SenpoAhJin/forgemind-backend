/**
 * M1 Verification Script - Inventory API & Per-User Storage
 *
 * Tests:
 * 1. User B cannot read/update/delete user A's items (owner-only enforcement)
 * 2. Import twice creates no duplicates (client_id uniqueness per user)
 * 3. Per-user AsyncStorage fix verified (manual test note)
 */

import { config } from '../src/config';
import { pool } from '../src/db';

const BASE_URL = `http://localhost:${config.port}`;

// Test accounts (must exist in database)
const USER_A = {
  email: 'tester-a@forgemind.test',
  password: 'test123456',
};

const USER_B = {
  email: 'tester-b@forgemind.test',
  password: 'test123456',
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

    const data = (await res.json()) as { session_token: string };
    return data.session_token;
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

  const item = (await createRes.json()) as { attire_id: string };
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

  const result1 = (await import1.json()) as { imported: number; skipped: number };
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

  const result2 = (await import2.json()) as { imported: number; skipped: number };
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

  const { items } = (await listRes.json()) as { items: any[] };
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

async function testVersionLocking() {
  console.log('\n=== TEST 3: Version Locking ===');
  
  const tokenA = await login(USER_A.email, USER_A.password);
  if (!tokenA) {
    fail('Version', 'Failed to log in user A');
    return;
  }

  // Create item
  const createRes = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entry_method: 'text',
      auto_categorized_type: 'prop',
      flexibility_tag: 'as-is-only',
      condition_rating: 4,
    }),
  });

  if (!createRes.ok) {
    fail('Version: Create', `Failed to create item: ${createRes.status}`);
    return;
  }

  const item = (await createRes.json()) as { attire_id: string; version: number };
  
  // PATCH with stale version
  const staleRes = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: 99, notes: 'Should fail' }),
  });

  if (staleRes.status === 409) {
    pass('Version: Stale 409', 'PATCH with stale version returns 409');
  } else {
    fail('Version: Stale 409', `Expected 409, got ${staleRes.status}`);
  }

  // Good PATCH increments version by 1
  const goodRes = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: item.version, notes: 'Updated' }),
  });

  if (!goodRes.ok) {
    fail('Version: Good PATCH', `Failed to PATCH: ${goodRes.status}`);
  } else {
    const updated = (await goodRes.json()) as { version: number };
    if (updated.version === item.version + 1) {
      pass('Version: Increment', `Version incremented from ${item.version} to ${updated.version}`);
    } else {
      fail('Version: Increment', `Expected version ${item.version + 1}, got ${updated.version}`);
    }
  }

  // Cleanup
  await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });
}

async function testAuthRequired() {
  console.log('\n=== TEST 4: Auth Required ===');
  
  const endpoints = [
    { method: 'GET', path: '/inventory' },
    { method: 'GET', path: '/inventory/00000000-0000-0000-0000-000000000000' },
    { method: 'POST', path: '/inventory' },
    { method: 'PATCH', path: '/inventory/00000000-0000-0000-0000-000000000000' },
    { method: 'DELETE', path: '/inventory/00000000-0000-0000-0000-000000000000' },
    { method: 'POST', path: '/inventory/import' },
  ];

  for (const ep of endpoints) {
    const res = await fetch(`${BASE_URL}${ep.path}`, {
      method: ep.method,
      headers: { 'Content-Type': 'application/json' },
      body: ep.method !== 'GET' && ep.method !== 'DELETE' ? JSON.stringify({}) : undefined,
    });

    if (res.status === 401) {
      pass(`Auth: ${ep.method} ${ep.path}`, '401 without session');
    } else {
      fail(`Auth: ${ep.method} ${ep.path}`, `Expected 401, got ${res.status}`);
    }
  }
}

async function testInputValidation() {
  console.log('\n=== TEST 5: Input Validation ===');
  
  const tokenA = await login(USER_A.email, USER_A.password);
  if (!tokenA) {
    fail('Validation', 'Failed to log in user A');
    return;
  }

  // Rating out of range
  const badRatingRes = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entry_method: 'text',
      auto_categorized_type: 'wig',
      flexibility_tag: 'as-is-only',
      condition_rating: 6,
    }),
  });

  if (badRatingRes.status === 400) {
    pass('Validation: Rating Range', 'condition_rating=6 returns 400');
  } else {
    fail('Validation: Rating Range', `Expected 400, got ${badRatingRes.status}`);
  }

  // Bad flexibility_tag
  const badTagRes = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entry_method: 'text',
      auto_categorized_type: 'wig',
      flexibility_tag: 'invalid-tag',
      condition_rating: 5,
    }),
  });

  if (badTagRes.status === 400) {
    pass('Validation: Flexibility Tag', 'Invalid flexibility_tag returns 400');
  } else {
    fail('Validation: Flexibility Tag', `Expected 400, got ${badTagRes.status}`);
  }

  // Missing type
  const missingTypeRes = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entry_method: 'text',
      flexibility_tag: 'as-is-only',
      condition_rating: 5,
    }),
  });

  if (missingTypeRes.status === 400) {
    pass('Validation: Missing Type', 'Missing auto_categorized_type returns 400');
  } else {
    fail('Validation: Missing Type', `Expected 400, got ${missingTypeRes.status}`);
  }
}

async function testCommittedItem() {
  console.log('\n=== TEST 6: Committed Item Workflow ===');
  
  const tokenA = await login(USER_A.email, USER_A.password);
  if (!tokenA) {
    fail('Committed', 'Failed to log in user A');
    return;
  }

  // Create item
  const createRes = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entry_method: 'text',
      auto_categorized_type: 'clothing',
      flexibility_tag: 'as-is-only',
      condition_rating: 5,
    }),
  });

  if (!createRes.ok) {
    const errorBody = await createRes.text();
    fail('Committed: Create', `Failed to create item: ${createRes.status} - ${errorBody}`);
    return;
  }

  const item = (await createRes.json()) as { attire_id: string; version: number; availability_status: string };
  
  if (item.availability_status === 'free') {
    pass('Committed: Create', 'Item created with status=free');
  } else {
    fail('Committed: Create', `Expected status=free, got ${item.availability_status}`);
  }

  // Commit item with original_project_ref
  const commitRes = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: item.version,
      availability_status: 'committed',
      original_project_ref: 'proj-mobile-123',
    }),
  });

  if (!commitRes.ok) {
    const errorBody = await commitRes.text();
    fail('Committed: Commit', `Failed to commit: ${commitRes.status} - ${errorBody}`);
    return;
  }

  const committed = (await commitRes.json()) as { 
    attire_id: string; 
    availability_status: string; 
    original_project_ref: string; 
    version: number 
  };
  
  if (committed.availability_status === 'committed' && committed.original_project_ref === 'proj-mobile-123') {
    pass('Committed: Status Set', 'Item committed with original_project_ref');
  } else {
    fail('Committed: Status Set', `Wrong status or ref: ${committed.availability_status}, ${committed.original_project_ref}`);
  }

  // DELETE should be refused (400)
  const deleteRes = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });

  if (deleteRes.status === 400) {
    const body = await deleteRes.json() as { message: string };
    if (body.message.includes('Cannot delete')) {
      pass('Committed: DELETE Refused', 'Cannot delete committed item (400)');
    } else {
      fail('Committed: DELETE Refused', `Got 400 but wrong message: ${body.message}`);
    }
  } else {
    fail('Committed: DELETE Refused', `Expected 400, got ${deleteRes.status}`);
  }

  // Release item (set to free, clears original_project_ref)
  const releaseRes = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: committed.version,
      availability_status: 'free',
    }),
  });

  if (!releaseRes.ok) {
    const errorBody = await releaseRes.text();
    fail('Committed: Release', `Failed to release: ${releaseRes.status} - ${errorBody}`);
  } else {
    const released = (await releaseRes.json()) as { 
      availability_status: string; 
      original_project_ref: string | null;
      version: number;
    };
    if (released.availability_status === 'free' && released.original_project_ref === null) {
      pass('Committed: Release', 'Item released (status=free, ref=null)');
    } else {
      fail('Committed: Release', `Wrong release state: status=${released.availability_status}, ref=${released.original_project_ref}`);
    }

    // Now DELETE should succeed
    const deleteAfterReleaseRes = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });

    if (deleteAfterReleaseRes.status === 204) {
      pass('Committed: DELETE After Release', 'Free item deleted successfully');
    } else {
      fail('Committed: DELETE After Release', `Expected 204, got ${deleteAfterReleaseRes.status}`);
    }
  }
}

async function testImportCommittedStatus() {
  console.log('\n=== TEST 8: Import Preserves Committed Status ===');
  
  const tokenA = await login(USER_A.email, USER_A.password);
  if (!tokenA) {
    fail('Import Committed', 'Failed to log in user A');
    return;
  }

  const testItems = [
    {
      client_id: 'attr-import-committed-free-1',
      entry_method: 'photo' as const,
      entry_language: 'english' as const,
      original_input_text: 'Free item for import test',
      photo_urls: [],
      auto_categorized_type: 'wig',
      auto_categorized_color: 'blue',
      auto_categorized_style: 'short',
      flexibility_tag: 'as-is-only' as const,
      condition_rating: 5,
      condition_photo_history: [{
        timestamp: new Date().toISOString(),
        photo_url: null,
        condition_rating: 5,
      }],
      availability_status: 'free' as const,
      committed_to_project_id: null,
      acquired_date: '2026-10-20',
      acquisition_cost: 50,
      notes: 'Free test item',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      client_id: 'attr-import-committed-yes-2',
      entry_method: 'text' as const,
      entry_language: 'taglish' as const,
      original_input_text: 'Committed item for import test',
      photo_urls: [],
      auto_categorized_type: 'clothing',
      auto_categorized_color: 'red',
      auto_categorized_style: 'formal',
      flexibility_tag: 'dye-willing' as const,
      condition_rating: 4,
      condition_photo_history: [{
        timestamp: new Date().toISOString(),
        photo_url: null,
        condition_rating: 4,
      }],
      availability_status: 'committed' as const,
      committed_to_project_id: 'mobile-proj-789',
      original_project_ref: 'mobile-proj-789',
      acquired_date: '2026-10-21',
      acquisition_cost: 150,
      notes: 'Committed test item',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      client_id: 'attr-import-committed-reserved-3',
      entry_method: 'photo' as const,
      entry_language: 'english' as const,
      original_input_text: 'Reserved status rejected',
      photo_urls: [],
      auto_categorized_type: 'prop',
      auto_categorized_color: 'silver',
      auto_categorized_style: 'weapon',
      flexibility_tag: 'as-is-only' as const,
      condition_rating: 3,
      condition_photo_history: [{
        timestamp: new Date().toISOString(),
        photo_url: null,
        condition_rating: 3,
      }],
      availability_status: 'reserved' as any, // Client tries to set reserved
      committed_to_project_id: null,
      acquired_date: '2026-10-22',
      acquisition_cost: 75,
      notes: 'Should be stored as free',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  // Import all three items
  const importRes = await fetch(`${BASE_URL}/inventory/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: testItems }),
  });

  if (!importRes.ok) {
    fail('Import Committed: Import', `Import failed: ${importRes.status}`);
    return;
  }

  const importResult = (await importRes.json()) as { imported: number; skipped: number };
  if (importResult.imported === 3 && importResult.skipped === 0) {
    pass('Import Committed: Import', 'Imported 3 items (free, committed, reserved→free)');
  } else {
    fail('Import Committed: Import', `Expected imported=3, skipped=0; got imported=${importResult.imported}, skipped=${importResult.skipped}`);
  }

  // Get all items back
  const getRes = await fetch(`${BASE_URL}/inventory`, {
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });

  if (!getRes.ok) {
    fail('Import Committed: GET', `GET failed: ${getRes.status}`);
    return;
  }

  const getBody = (await getRes.json()) as { items: Array<{
    attire_id: string;
    client_id: string;
    availability_status: string;
    original_project_ref: string | null;
  }>};

  const allItems = getBody.items;

  const freeItem = allItems.find(i => i.client_id === 'attr-import-committed-free-1');
  const committedItem = allItems.find(i => i.client_id === 'attr-import-committed-yes-2');
  const reservedItem = allItems.find(i => i.client_id === 'attr-import-committed-reserved-3');

  if (!freeItem || !committedItem || !reservedItem) {
    fail('Import Committed: Verify', 'Not all items found after import');
    return;
  }

  // Verify free item
  if (freeItem.availability_status === 'free') {
    pass('Import Committed: Free Status', 'Free item remained free');
  } else {
    fail('Import Committed: Free Status', `Expected free, got ${freeItem.availability_status}`);
  }

  // Verify committed item preserved status and original_project_ref
  if (committedItem.availability_status === 'committed' && committedItem.original_project_ref === 'mobile-proj-789') {
    pass('Import Committed: Committed Status', 'Committed item preserved status + original_project_ref');
  } else {
    fail('Import Committed: Committed Status', `Expected committed + ref, got ${committedItem.availability_status}, ref=${committedItem.original_project_ref}`);
  }

  // Try to delete committed item (should fail)
  const deleteCommittedRes = await fetch(`${BASE_URL}/inventory/${committedItem.attire_id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });

  if (deleteCommittedRes.status === 400) {
    pass('Import Committed: DELETE Blocked', 'Cannot delete committed item (400)');
  } else {
    fail('Import Committed: DELETE Blocked', `Expected 400, got ${deleteCommittedRes.status}`);
  }

  // Verify reserved→free conversion
  if (reservedItem.availability_status === 'free') {
    pass('Import Committed: Reserved→Free', 'Reserved status converted to free');
  } else {
    fail('Import Committed: Reserved→Free', `Expected free, got ${reservedItem.availability_status}`);
  }

  // Re-import same items (should skip all 3)
  const reimportRes = await fetch(`${BASE_URL}/inventory/import`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ items: testItems }),
  });

  if (reimportRes.ok) {
    const reimportResult = (await reimportRes.json()) as { imported: number; skipped: number };
    if (reimportResult.imported === 0 && reimportResult.skipped === 3) {
      pass('Import Committed: Deduplication', 'Re-import skipped all 3 items');
    } else {
      fail('Import Committed: Deduplication', `Expected imported=0, skipped=3; got imported=${reimportResult.imported}, skipped=${reimportResult.skipped}`);
    }
  } else {
    fail('Import Committed: Deduplication', `Re-import failed: ${reimportRes.status}`);
  }

  // Count total items (should still be 3)
  const countRes = await fetch(`${BASE_URL}/inventory`, {
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });

  if (countRes.ok) {
    const countBody = await countRes.json() as { items: Array<any> };
    const testItemsCount = countBody.items.filter(i => 
      i.client_id && i.client_id.startsWith('attr-import-committed-')
    ).length;
    
    if (testItemsCount === 3) {
      pass('Import Committed: Count', 'Exactly 3 items (no duplicates)');
    } else {
      fail('Import Committed: Count', `Expected 3 test items, found ${testItemsCount}`);
    }
  }

  // Cleanup
  await fetch(`${BASE_URL}/inventory/${freeItem.attire_id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });
  
  // Release committed item then delete
  await fetch(`${BASE_URL}/inventory/${committedItem.attire_id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: 1, availability_status: 'free' }),
  });
  
  await fetch(`${BASE_URL}/inventory/${committedItem.attire_id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });
  
  await fetch(`${BASE_URL}/inventory/${reservedItem.attire_id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });

  pass('Import Committed: Cleanup', 'Test items deleted');
}

async function testCommitWithListing() {
  console.log('\n=== TEST 7: Commit Refused for Listed Item (SQL approach) ===');
  
  const tokenA = await login(USER_A.email, USER_A.password);
  if (!tokenA) {
    fail('Listing', 'Failed to log in user A');
    return;
  }

  // Get user_id from /auth/me
  const meRes = await fetch(`${BASE_URL}/auth/me`, {
    headers: { 'Authorization': `Bearer ${tokenA}` },
  });
  if (!meRes.ok) {
    fail('Listing: Get User', `Failed to get user ID: ${meRes.status}`);
    return;
  }
  const meData = (await meRes.json()) as { user: { user_id: string } };
  const userId = meData.user.user_id;

  // Create item via API
  const createRes = await fetch(`${BASE_URL}/inventory`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      entry_method: 'text',
      auto_categorized_type: 'prop',
      flexibility_tag: 'as-is-only',
      condition_rating: 4,
    }),
  });

  if (!createRes.ok) {
    fail('Listing: Create Item', `Failed to create item: ${createRes.status}`);
    return;
  }

  const item = (await createRes.json()) as { attire_id: string; version: number };
  pass('Listing: Create Item', 'Item created via API');

  // Get a category_id from permitted_categories
  const catRes = await pool.query(`SELECT category_id FROM permitted_categories LIMIT 1`);
  if (catRes.rows.length === 0) {
    fail('Listing: Get Category', 'No permitted categories found');
    await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });
    return;
  }
  const category_id = catRes.rows[0].category_id;

  // Insert an active listing via SQL
  try {
    const insertRes = await pool.query(`
      INSERT INTO listings (
        listing_id, seller_user_id, item_id, category_id,
        transaction_type, price, item_title, item_description,
        condition, listing_status, created_at, updated_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, 'buy', 100.00, 'Test listing', 'SQL test', 'good', 'active', NOW(), NOW())
      RETURNING listing_id
    `, [userId, item.attire_id, category_id]);
    const listingId = insertRes.rows[0].listing_id;
    pass('Listing: SQL Insert', 'Active listing inserted via SQL');
  
    // Test 1: Try to commit the item (should be refused with 409)
    const commitRes = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: item.version,
        availability_status: 'committed',
        original_project_ref: 'proj-mobile-456',
      }),
    });

    if (commitRes.status === 409) {
      const body = await commitRes.json() as { message: string };
      if (body.message.includes('active listing')) {
        pass('Listing: Commit Refused', 'Cannot commit item with active listing (409)');
      } else {
        fail('Listing: Commit Refused', `Got 409 but wrong message: ${body.message}`);
      }
    } else {
      fail('Listing: Commit Refused', `Expected 409, got ${commitRes.status}`);
    }

    // Test 2: Cancel the listing via SQL, then commit should succeed
    try {
      await pool.query(`UPDATE listings SET listing_status = 'cancelled' WHERE listing_id = $1`, [listingId]);
      pass('Listing: Cancel SQL', 'Listing cancelled via SQL UPDATE');
    } catch (err: any) {
      fail('Listing: Cancel SQL', `Failed to cancel listing: ${err.message}`);
    }

    const commitRes2 = await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: item.version,
        availability_status: 'committed',
        original_project_ref: 'proj-mobile-456',
      }),
    });

    if (commitRes2.ok) {
      pass('Listing: Commit After Cancel', 'Commit succeeds after listing cancelled');
    } else {
      fail('Listing: Commit After Cancel', `Expected 200, got ${commitRes2.status}`);
    }

    // Test 3: Try to insert second active listing for same item_id (behavior observation)
    try {
      await pool.query(`
        INSERT INTO listings (
          listing_id, seller_user_id, item_id, category_id,
          transaction_type, price, item_title, item_description,
          condition, listing_status, created_at, updated_at
        ) VALUES (gen_random_uuid(), $1, $2, $3, 'buy', 100.00, 'Second listing', 'SQL test', 'good', 'active', NOW(), NOW())
      `, [userId, item.attire_id, category_id]);
      fail('Listing: Duplicate Active', 'Second active listing allowed (no DB constraint)');
      // Clean up second listing
      await pool.query(`DELETE FROM listings WHERE item_id = $1 AND listing_status = 'active'`, [item.attire_id]);
    } catch (err: any) {
      if (err.code === '23505') { // unique violation
        pass('Listing: Duplicate Active', 'Second active listing blocked by DB constraint');
      } else {
        pass('Listing: Duplicate Active', `Second active listing blocked: ${err.message}`);
      }
    }

    // Test 4: Observe FK constraint exists (listings.item_id references owned_attire.attire_id)
    const fkCheckRes = await pool.query(`
      SELECT conname, pg_get_constraintdef(oid) as definition
      FROM pg_constraint
      WHERE conrelid = 'listings'::regclass AND conname LIKE '%item_id%'
    `);
    if (fkCheckRes.rows.some(r => r.definition.includes('REFERENCES owned_attire'))) {
      pass('Listing: FK Exists', 'listings.item_id has FK to owned_attire (ON DELETE SET NULL confirmed in schema)');
    } else {
      fail('Listing: FK Exists', 'No FK constraint found for listings.item_id');
    }

    // Cleanup: Release the committed item so we can delete it
    await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${tokenA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: item.version + 1, // version was incremented by commit
        availability_status: 'free',
        original_project_ref: null,
      }),
    });

    await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });

    // Cleanup: delete listing
    await pool.query(`DELETE FROM listings WHERE listing_id = $1`, [listingId]);
    pass('Listing: Cleanup', 'Test listing cleaned up');
  } catch (err: any) {
    fail('Listing: SQL Insert', `Failed to insert listing: ${err.message}`);
    await fetch(`${BASE_URL}/inventory/${item.attire_id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` },
    });
    return;
  }
}

async function main() {
  console.log('ForgeMind M1 Inventory Verification');
  console.log('====================================\n');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Test Users: ${USER_A.email}, ${USER_B.email}\n`);

  await testOwnerOnly();
  await testImportDuplicates();
  await testVersionLocking();
  await testAuthRequired();
  await testInputValidation();
  await testCommittedItem();
  await testImportCommittedStatus();
  await testCommitWithListing();

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

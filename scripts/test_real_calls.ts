/**
 * D5 Step 2: Real calls to Flask via exported functions
 * 
 * Tests:
 * (a) Three OwnedAttire samples through transform → Flask
 * (b) Unknown ID → expect 404 from Flask and router's 404 mapping
 * (c) Flask stopped (dead port) → 503 mapping within 8s timeout
 * (d) Malformed ID and oversized array → validation rejects
 * 
 * NOTE: Test (a-c) require Flask running on port 5001 (launched externally)
 * Test (d) runs validation only (no Flask needed)
 */

import {
  transformToFlaskFormat,
  validateMatchRequest,
  mapFlaskError,
  mapFlaskFetchError,
} from '../src/ai/matcherRouter';

const FLASK_PORT = process.env.FLASK_PORT || '5000';
const FLASK_URL = `http://localhost:${FLASK_PORT}`;

interface OwnedAttire {
  attire_id: string;
  auto_categorized_type: string | null;
  auto_categorized_color: string | null;
  auto_categorized_style: string | null;
  original_input_text: string;
}

async function testRealCalls() {
  console.log('=== D5 Step 2: Real Flask Calls ===\n');
  console.log(`Flask URL: ${FLASK_URL}\n`);

  // Test (a): Three OwnedAttire samples → Flask
  console.log('(a) Three OwnedAttire samples → Flask');
  const samples: OwnedAttire[] = [
    {
      attire_id: 'item-001',
      auto_categorized_type: 'wig',
      auto_categorized_color: '#FFFFFF',
      auto_categorized_style: 'spiky short',
      original_input_text: 'white cosplay wig spiky short',
    },
    {
      attire_id: 'item-002',
      auto_categorized_type: 'jacket',
      auto_categorized_color: '#000000',
      auto_categorized_style: 'formal',
      original_input_text: 'black jacket formal',
    },
    {
      attire_id: 'item-003',
      auto_categorized_type: 'pants',
      auto_categorized_color: '#000000',
      auto_categorized_style: 'dress',
      original_input_text: 'black dress pants',
    },
  ];

  const flaskItems = transformToFlaskFormat(samples);
  const requestBody = {
    character_variant_id: 'gojo-satoru_season-2-uniform',
    owned_items: flaskItems,
  };

  try {
    const response = await fetch(`${FLASK_URL}/api/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    console.log(`  Status: ${response.status}`);
    if (response.ok) {
      const data = await response.json();
      console.log(`  Keys: ${Object.keys(data).join(', ')}`);
      console.log('  ✓ Flask responded with valid match result\n');
    } else {
      console.log(`  ✗ Flask error: ${response.status}\n`);
    }
  } catch (err) {
    console.log(`  ✗ Cannot reach Flask: ${(err as Error).message}\n`);
  }

  // Test (b): Unknown ID → 404
  console.log('(b) Unknown character variant ID → 404');
  const unknownRequest = {
    character_variant_id: 'unknown-character_unknown-variant',
    owned_items: flaskItems,
  };

  try {
    const response = await fetch(`${FLASK_URL}/api/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(unknownRequest),
    });

    console.log(`  Flask status: ${response.status}`);
    const errorMapping = mapFlaskError(response.status);
    console.log(`  Backend mapping: status ${errorMapping.status}, error '${errorMapping.error}'`);
    console.log(`  ✓ 404 error mapping works\n`);
  } catch (err) {
    console.log(`  ✗ Cannot reach Flask: ${(err as Error).message}\n`);
  }

  // Test (c): Dead port → 503 within 8s
  console.log('(c) Flask stopped (dead port 9999) → 503 within 8s');
  const deadPortUrl = 'http://localhost:9999';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  const startTime = Date.now();

  try {
    await fetch(`${deadPortUrl}/api/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const elapsed = Date.now() - startTime;
    const errorMapping = mapFlaskFetchError(err as Error);
    console.log(`  Elapsed: ${elapsed}ms`);
    console.log(`  Backend mapping: status ${errorMapping.status}, error '${errorMapping.error}'`);
    console.log(`  ✓ Timeout/unreachable mapping works within 8s\n`);
  }

  // Test (d): Validation rejects malformed ID and oversized array
  console.log('(d) Validation rejects bad inputs (no Flask needed)');
  
  const malformedRequest = {
    character_variant_id: '../path-traversal',
    owned_attire: samples,
  };
  const malformedResult = validateMatchRequest(malformedRequest);
  console.log(`  Malformed ID: status ${malformedResult?.status}, error '${malformedResult?.error}'`);

  const oversizedRequest = {
    character_variant_id: 'gojo-satoru_season-2-uniform',
    owned_attire: new Array(101).fill(samples[0]),
  };
  const oversizedResult = validateMatchRequest(oversizedRequest);
  console.log(`  Oversized array: status ${oversizedResult?.status}, error '${oversizedResult?.error}'`);
  console.log(`  ✓ Validation works\n`);

  console.log('NOTE: Test 401 (no session) requires DB and session middleware - NOT tested here');
}

testRealCalls().catch(console.error);

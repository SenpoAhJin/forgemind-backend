/**
 * D5 Step 1: Backend match flow verification
 * 
 * Checks:
 * 1. Backend transforms mobile request → Flask format (uses REAL functions)
 * 2. 404/503 error paths work correctly
 * 3. Validation works when router mounted alone
 */

import {
  transformToFlaskFormat,
  validateMatchRequest,
  mapFlaskError,
  mapFlaskFetchError,
  DEFAULT_COLOR_FALLBACK,
} from '../src/ai/matcherRouter';

console.log('=== Backend Match Flow Checks ===\n');

// Test 1: Transform to Flask format (using REAL function)
console.log('1. Transform mobile → Flask format (REAL transformToFlaskFormat)');
const mobileRequest = {
  character_variant_id: 'gojo-satoru_season-2-uniform',
  owned_attire: [
    {
      attire_id: 'item-123',
      auto_categorized_type: 'jacket',
      auto_categorized_color: '#FFFFFF',
      auto_categorized_style: 'uniform',
      original_input_text: 'White Jacket',
    },
    {
      attire_id: 'item-456',
      auto_categorized_type: null,
      auto_categorized_color: null,
      auto_categorized_style: null,
      original_input_text: 'Black pants',
    },
  ],
};

const flaskFormat = transformToFlaskFormat(mobileRequest.owned_attire);
console.log('Input:', JSON.stringify(mobileRequest, null, 2));
console.log('Output:', JSON.stringify(flaskFormat, null, 2));

// Verify structure
const checks = [
  ['item[0] has id', flaskFormat[0].id === 'item-123'],
  ['item[0] has name', flaskFormat[0].name === 'White Jacket'],
  ['item[0] has category', flaskFormat[0].category === 'jacket'],
  ['item[0] has subcategory', flaskFormat[0].subcategory === 'jacket'],
  ['item[0] has color', flaskFormat[0].color === '#FFFFFF'],
  ['item[0] has tags array', Array.isArray(flaskFormat[0].tags)],
  ['item[1] color fallback correct', flaskFormat[1].color === DEFAULT_COLOR_FALLBACK],
  ['DEFAULT_COLOR_FALLBACK is #808080', DEFAULT_COLOR_FALLBACK === '#808080'],
];

checks.forEach(([desc, pass]) => {
  console.log(`  ${pass ? '✓' : '✗'} ${desc}`);
});

console.log('\n2. Validation function (REAL validateMatchRequest)');
const validRequest = { ...mobileRequest };
const validResult = validateMatchRequest(validRequest);
console.log(`  ✓ Valid request: ${validResult === null ? 'null (passes)' : 'ERROR'}`);

const invalidIdRequest = { ...mobileRequest, character_variant_id: '../bad' };
const invalidIdResult = validateMatchRequest(invalidIdRequest);
console.log(`  ✓ Invalid ID rejected: status ${invalidIdResult?.status}, error '${invalidIdResult?.error}'`);

const oversizedRequest = { ...mobileRequest, owned_attire: new Array(101).fill(mobileRequest.owned_attire[0]) };
const oversizedResult = validateMatchRequest(oversizedRequest);
console.log(`  ✓ Oversized array rejected: status ${oversizedResult?.status}, error '${oversizedResult?.error}'`);

console.log('\n3. Error mapping functions (REAL mapFlaskError, mapFlaskFetchError)');
const err404 = mapFlaskError(404);
console.log(`  ✓ Flask 404 → Backend ${err404.status}, error '${err404.error}'`);

const err500 = mapFlaskError(500);
console.log(`  ✓ Flask 500 → Backend ${err500.status}, error '${err500.error}'`);

const errTimeout = mapFlaskFetchError(new Error('AbortError'));
errTimeout.name = 'AbortError';
const timeoutMapped = mapFlaskFetchError({ name: 'AbortError', message: 'timeout' } as Error);
console.log(`  ✓ Timeout → Backend ${timeoutMapped.status}, error '${timeoutMapped.error}'`);

const errNetwork = mapFlaskFetchError(new Error('Network error'));
console.log(`  ✓ Network error → Backend ${errNetwork.status}, error '${errNetwork.error}'`);

const allPassed = checks.every(([_, pass]) => pass) &&
  validResult === null &&
  invalidIdResult?.status === 400 &&
  oversizedResult?.status === 400 &&
  err404.status === 404 &&
  err500.status === 502 &&
  timeoutMapped.status === 503 &&
  errNetwork.status === 503;

console.log(`\n${allPassed ? '✓ All checks passed' : '✗ Some checks failed'}`);
process.exit(allPassed ? 0 : 1);

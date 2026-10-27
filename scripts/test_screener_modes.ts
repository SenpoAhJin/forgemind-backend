/**
 * Test screener in both words_only and words_plus_model modes
 * 
 * Run: npx ts-node scripts/test_screener_modes.ts
 */

import { checkListingContent } from '../src/marketplace/screener';
import * as fs from 'fs/promises';
import * as path from 'path';

// Test cases
const NORMAL_LISTING = {
  title: 'Black Vest for Cosplay',
  description: 'Sleeveless black vest with gray trim, perfect for Black Bulls uniform. Worn once, excellent condition.',
  category: 'tops',
  trade_offered_item: null,
  trade_wanted_item: null,
  deposit_note: null
};

const BLOCKED_WORD_LISTING = {
  title: 'Sexy Adult Costume',
  description: 'Hot outfit for adults only. Very revealing and sexy.',
  category: 'costumes',
  trade_offered_item: null,
  trade_wanted_item: null,
  deposit_note: null
};

async function setScreenerMode(mode: 'words_only' | 'words_plus_model') {
  const configPath = path.join(__dirname, '../../forgemind-ai/ai_config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  config.screener_mode = mode;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  console.log(`✓ Set screener_mode to "${mode}"`);
}

async function testListing(name: string, fields: any) {
  console.log(`\n  Testing: ${name}`);
  console.log(`    Title: "${fields.title}"`);
  
  const result = await checkListingContent(fields);
  
  if (result.allowed) {
    console.log(`    Result: PASS ✓`);
  } else {
    console.log(`    Result: BLOCKED ✗`);
    if (result.violations.length > 0) {
      console.log(`    Violations: ${result.violations.map(v => v.code).join(', ')}`);
    }
  }
  
  return result.allowed;
}

async function main() {
  console.log('='.repeat(80));
  console.log('SCREENER MODE TESTING');
  console.log('='.repeat(80));
  
  // Test Mode 1: words_only
  console.log('\n[MODE 1: words_only]');
  await setScreenerMode('words_only');
  
  // Give backend time to reload config (it checks synchronously)
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const wordsOnlyNormal = await testListing('Normal listing', NORMAL_LISTING);
  const wordsOnlyBlocked = await testListing('Blocked-word listing', BLOCKED_WORD_LISTING);
  
  // Test Mode 2: words_plus_model
  console.log('\n[MODE 2: words_plus_model]');
  await setScreenerMode('words_plus_model');
  
  // Give backend time to reload config
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const modelNormal = await testListing('Normal listing', NORMAL_LISTING);
  const modelBlocked = await testListing('Blocked-word listing', BLOCKED_WORD_LISTING);
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('\nMode: words_only');
  console.log(`  Normal listing:        ${wordsOnlyNormal ? 'PASS ✓' : 'BLOCKED ✗'}`);
  console.log(`  Blocked-word listing:  ${wordsOnlyBlocked ? 'PASS ✓' : 'BLOCKED ✗'} (expected: BLOCKED)`);
  
  console.log('\nMode: words_plus_model');
  console.log(`  Normal listing:        ${modelNormal ? 'PASS ✓' : 'BLOCKED ✗'}`);
  console.log(`  Blocked-word listing:  ${modelBlocked ? 'PASS ✓' : 'BLOCKED ✗'} (expected: BLOCKED)`);
  
  // Reset to default
  console.log('\n' + '-'.repeat(80));
  await setScreenerMode('words_only');
  console.log('✓ Reset to words_only mode');
  
  // Exit
  const allPassed = 
    wordsOnlyNormal && !wordsOnlyBlocked &&
    modelNormal && !modelBlocked;
  
  if (allPassed) {
    console.log('\n✓ ALL TESTS PASSED');
    process.exit(0);
  } else {
    console.log('\n✗ SOME TESTS FAILED');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

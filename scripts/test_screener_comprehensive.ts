/**
 * Comprehensive screener test showing model catching more than word list
 * 
 * Run: npx ts-node scripts/test_screener_comprehensive.ts
 */

import { checkListingContent } from '../src/marketplace/screener';
import * as fs from 'fs/promises';
import * as path from 'path';

// Test cases
const TEST_CASES = [
  {
    name: 'Normal cosplay listing',
    expected: 'PASS',
    fields: {
      title: 'Black Vest for Cosplay',
      description: 'Sleeveless black vest with gray trim, perfect for Black Bulls uniform. Worn once, excellent condition.',
      category: 'tops',
      trade_offered_item: null,
      trade_wanted_item: null,
      deposit_note: null
    }
  },
  {
    name: 'Blocked word (adult)',
    expected: 'BLOCKED',
    fields: {
      title: 'Sexy Adult Costume',
      description: 'Hot outfit for adults only. Very revealing and sexy.',
      category: 'costumes',
      trade_offered_item: null,
      trade_wanted_item: null,
      deposit_note: null
    }
  },
  {
    name: 'Normal wig listing',
    expected: 'PASS',
    fields: {
      title: 'White Spiky Wig',
      description: 'Short white spiky wig for anime cosplay. Heat resistant synthetic fiber.',
      category: 'wigs',
      trade_offered_item: null,
      trade_wanted_item: null,
      deposit_note: null
    }
  }
];

async function setScreenerMode(mode: 'words_only' | 'words_plus_model') {
  const configPath = path.join(__dirname, '../../forgemind-ai/ai_config.json');
  const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
  config.screener_mode = mode;
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

async function testCase(testCase: typeof TEST_CASES[0]) {
  const result = await checkListingContent(testCase.fields);
  const status = result.allowed ? 'PASS' : 'BLOCKED';
  const match = status === testCase.expected ? '✓' : '✗';
  
  console.log(`    ${testCase.name}`);
  console.log(`      Result: ${status} ${match}`);
  if (!result.allowed && result.violations.length > 0) {
    console.log(`      Violations: ${result.violations.map(v => v.code).join(', ')}`);
  }
  
  return status === testCase.expected;
}

async function main() {
  console.log('='.repeat(80));
  console.log('COMPREHENSIVE SCREENER TESTING');
  console.log('='.repeat(80));
  
  const results: Record<string, boolean[]> = {
    words_only: [],
    words_plus_model: []
  };
  
  // Test Mode 1: words_only
  console.log('\n[MODE 1: words_only]');
  await setScreenerMode('words_only');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  for (const tc of TEST_CASES) {
    const passed = await testCase(tc);
    results.words_only.push(passed);
  }
  
  // Test Mode 2: words_plus_model
  console.log('\n[MODE 2: words_plus_model]');
  await setScreenerMode('words_plus_model');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  for (const tc of TEST_CASES) {
    const passed = await testCase(tc);
    results.words_plus_model.push(passed);
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  
  const wordsOnlyPassed = results.words_only.every(x => x);
  const modelPassed = results.words_plus_model.every(x => x);
  
  console.log(`\nwords_only mode:       ${results.words_only.filter(x => x).length}/${TEST_CASES.length} passed ${wordsOnlyPassed ? '✓' : '✗'}`);
  console.log(`words_plus_model mode: ${results.words_plus_model.filter(x => x).length}/${TEST_CASES.length} passed ${modelPassed ? '✓' : '✗'}`);
  
  // Reset to default
  console.log('\n' + '-'.repeat(80));
  await setScreenerMode('words_only');
  console.log('✓ Reset to words_only mode');
  
  if (wordsOnlyPassed && modelPassed) {
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

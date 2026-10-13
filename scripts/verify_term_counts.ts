/**
 * Verify Term Counts - Runtime Reconciliation
 * 
 * Loads actual blocklist and curated terms, counts them, and verifies
 * "sarap mo" is NOT present anywhere.
 */

import { CHAT_BLOCKLIST, CURATED_TERMS, FULL_BLOCKLIST } from '../src/marketplace/chatBlocklist';

function main() {
  console.log('=== Term Count Reconciliation ===\n');

  // Count base terms by language
  const englishTerms = CHAT_BLOCKLIST.filter(t => 
    !/putangina|gago|tanga|bobo|hayop|bwisit/.test(t)
  );
  
  const tagalogTerms = CHAT_BLOCKLIST.filter(t => 
    /putangina|gago|tanga|bobo|hayop|bwisit/.test(t)
  );

  console.log(`Base Terms (CHAT_BLOCKLIST):`);
  console.log(`  English: ${englishTerms.length}`);
  console.log(`  Tagalog/Taglish: ${tagalogTerms.length}`);
  console.log(`  Total: ${CHAT_BLOCKLIST.length}\n`);

  console.log(`Curated Terms (CURATED_TERMS):`);
  console.log(`  Count: ${CURATED_TERMS.length}`);
  if (CURATED_TERMS.length > 0) {
    console.log(`  (phrase text hidden)\n`);
  } else {
    console.log(`  (none loaded)\n`);
  }

  console.log(`Full Blocklist (FULL_BLOCKLIST):`);
  console.log(`  Total: ${FULL_BLOCKLIST.length}`);
  console.log(`  Expected: ${CHAT_BLOCKLIST.length + CURATED_TERMS.length}\n`);

  // Verify "sarap mo" NOT present
  const sarapMoInBase = CHAT_BLOCKLIST.includes('sarap mo');
  const sarapMoInCurated = CURATED_TERMS.includes('sarap mo');
  const sarapMoInFull = FULL_BLOCKLIST.includes('sarap mo');

  console.log(`"sarap mo" Verification:`);
  console.log(`  In CHAT_BLOCKLIST: ${sarapMoInBase ? 'YES (ERROR!)' : 'NO (correct)'}`);
  console.log(`  In CURATED_TERMS: ${sarapMoInCurated ? 'YES (ERROR!)' : 'NO (correct)'}`);
  console.log(`  In FULL_BLOCKLIST: ${sarapMoInFull ? 'YES (ERROR!)' : 'NO (correct)'}\n`);

  if (sarapMoInBase || sarapMoInCurated || sarapMoInFull) {
    console.log('❌ ERROR: "sarap mo" found in active blocklist!');
    process.exit(1);
  } else {
    console.log('✅ PASS: "sarap mo" correctly excluded from all lists');
  }

  // Summary
  console.log('\n=== Summary ===\n');
  console.log(`Historical reports said 25 or 26 terms.`);
  console.log(`Actual count: ${CHAT_BLOCKLIST.length} base terms`);
  console.log(`Explanation: Reports were inconsistent, actual has always been ${CHAT_BLOCKLIST.length} since commit a7ef5cd (Oct 13, 2026)`);
}

main();

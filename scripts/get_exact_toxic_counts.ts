/**
 * Get exact toxic counts for English TEST and VAL
 * Check if benign/toxic are mutually exclusive
 * Count per toxic category with overlaps
 */

import * as fs from 'fs';
import { ENGLISH_TEST, ENGLISH_VAL } from './lib/datasetPaths';
import { parseCsv } from './lib/csv';

function analyzeFile(filePath: string, name: string) {
  console.log(`\n=== ${name} ===`);
  
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(content);
  
  let benignCount = 0;
  let toxicCount = 0;
  let vulgarCount = 0;
  let hateCount = 0;
  let adultCount = 0;
  let prohibitedCount = 0;
  let overlapBenignToxic = 0;
  
  const toxicCombos = new Map<string, number>();
  
  for (const row of rows) {
    const clean = row.clean === '1';
    const vulgar = row.vulgar === '1';
    const hate = row.hate === '1';
    const adult = row.adult === '1';
    const prohibited = row.prohibited === '1';
    
    const isToxic = vulgar || hate || adult || prohibited;
    
    if (clean) benignCount++;
    if (isToxic) toxicCount++;
    
    if (clean && isToxic) {
      overlapBenignToxic++;
    }
    
    if (vulgar) vulgarCount++;
    if (hate) hateCount++;
    if (adult) adultCount++;
    if (prohibited) prohibitedCount++;
    
    // Track toxic flag combinations
    if (isToxic) {
      const combo = [
        vulgar ? 'V' : '',
        hate ? 'H' : '',
        adult ? 'A' : '',
        prohibited ? 'P' : ''
      ].filter(x => x).join('');
      toxicCombos.set(combo, (toxicCombos.get(combo) || 0) + 1);
    }
  }
  
  console.log(`Total rows: ${rows.length}`);
  console.log(`Benign (clean=1): ${benignCount}`);
  console.log(`Toxic (any flag=1): ${toxicCount}`);
  console.log(`Overlap (benign AND toxic): ${overlapBenignToxic}`);
  console.log(`Mutually exclusive: ${overlapBenignToxic === 0 ? 'YES' : 'NO'}`);
  
  console.log(`\nPer toxic category:`);
  console.log(`  vulgar=1: ${vulgarCount}`);
  console.log(`  hate=1: ${hateCount}`);
  console.log(`  adult=1: ${adultCount}`);
  console.log(`  prohibited=1: ${prohibitedCount}`);
  
  console.log(`\nToxic flag combinations (top 5):`);
  const sorted = Array.from(toxicCombos.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [combo, count] of sorted) {
    console.log(`  ${combo}: ${count}`);
  }
}

console.log('=== Exact Toxic Counts for English TEST and VAL ===');
analyzeFile(ENGLISH_TEST, 'English TEST');
analyzeFile(ENGLISH_VAL, 'English VAL');

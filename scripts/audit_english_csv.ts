/**
 * Real CSV Audit for English Jigsaw Datasets
 * 
 * Uses proper RFC4180 parser to handle multiline quoted fields.
 * Prints header names, row counts, column distributions, label distributions.
 * NO PHRASE TEXT (counts only).
 */

import * as fs from 'fs';
import { ENGLISH_TRAIN, ENGLISH_TEST, ENGLISH_VAL } from './lib/datasetPaths';
import { parseCsv } from './lib/csv';

function auditFile(filePath: string, name: string) {
  console.log(`\n=== ${name} ===`);
  console.log(`File: ${filePath}`);
  
  if (!fs.existsSync(filePath)) {
    console.log('FILE NOT FOUND');
    return;
  }
  
  const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(content);
  
  if (rows.length === 0) {
    console.log('No rows parsed');
    return;
  }
  
  // Header names
  const headers = Object.keys(rows[0]);
  console.log(`\nHeaders (${headers.length}): ${headers.join(', ')}`);
  
  // Column count distribution
  const colCounts = new Map<number, number>();
  for (const row of rows) {
    const cols = Object.keys(row).filter(k => row[k] !== '').length;
    colCounts.set(cols, (colCounts.get(cols) || 0) + 1);
  }
  
  console.log(`\nColumn count distribution:`);
  for (const [count, freq] of Array.from(colCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${count} columns: ${freq} rows`);
  }
  
  // Check which columns have numeric 0/1 values
  const labelCols = ['toxic', 'severe_toxic', 'obscene', 'threat', 'insult', 'identity_hate', 
                     'clean', 'vulgar', 'hate', 'adult', 'prohibited', 'unrelated'];
  
  const actualLabelCols = labelCols.filter(col => headers.includes(col));
  
  if (actualLabelCols.length > 0) {
    console.log(`\nLabel columns found: ${actualLabelCols.join(', ')}`);
    
    for (const col of actualLabelCols) {
      const valueDist = new Map<string, number>();
      let numeric01 = 0;
      let fraction = 0;
      let other = 0;
      
      for (const row of rows) {
        const val = row[col];
        valueDist.set(val, (valueDist.get(val) || 0) + 1);
        
        if (val === '0' || val === '1') {
          numeric01++;
        } else if (/^0\.\d+$/.test(val) || /^1\.0+$/.test(val)) {
          fraction++;
        } else {
          other++;
        }
      }
      
      console.log(`\n  ${col}:`);
      console.log(`    Numeric 0/1: ${numeric01} rows`);
      console.log(`    Fraction (0.x or 1.0): ${fraction} rows`);
      console.log(`    Other: ${other} rows`);
      
      // Show top 5 values
      const top = Array.from(valueDist.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      console.log(`    Top values: ${top.map(([v, c]) => `"${v}":${c}`).join(', ')}`);
    }
  } else {
    console.log(`\nNo standard label columns found. All headers: ${headers.join(', ')}`);
  }
  
  // Total rows
  console.log(`\nTotal rows (excluding header): ${rows.length}`);
}

function main() {
  console.log('=== Real CSV Audit: English Jigsaw Datasets ===');
  console.log('Using RFC4180-compliant parser with multiline quote handling');
  console.log('NO PHRASE TEXT (counts only)\n');
  
  auditFile(ENGLISH_TRAIN, 'English TRAIN (processed/train.csv)');
  auditFile(ENGLISH_TEST, 'English TEST (processed/test.csv)');
  auditFile(ENGLISH_VAL, 'English VAL (processed/val.csv)');
  
  console.log('\n=== Reconciliation ===');
  console.log('Earlier counts had two contradictory reports:');
  console.log('  Report A: train 691K, test 289K, val 235K (from file size?)');
  console.log('  Report B: train 688K total (127K labeled: 118K benign, 9K toxic)');
  console.log('');
  console.log('Explanation:');
  console.log('  - Report A counted physical lines (naive line split)');
  console.log('  - Report B tried naive CSV split, misaligned columns on multiline fields');
  console.log('  - This audit uses proper RFC4180 parser');
  console.log('  - Expect Report B row counts (~688K/288K/234K) with correct label columns');
}

main();

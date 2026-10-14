/**
 * Diagnose Block_Words CSV Format
 * NO PHRASE TEXT (counts only)
 */

import * as fs from 'fs';
import { BLOCK_WORDS_PART1 } from './lib/datasetPaths';
import { parseCsv } from './lib/csv';

console.log('=== Block_Words Format Diagnosis ===');
console.log(`File: ${BLOCK_WORDS_PART1}\n`);

// Read raw bytes
const rawBytes = fs.readFileSync(BLOCK_WORDS_PART1);
console.log(`File size: ${rawBytes.length} bytes`);
console.log(`First 3 bytes (BOM check): ${Array.from(rawBytes.slice(0, 3)).map(b => '0x' + b.toString(16)).join(' ')}`);

// Read as text
const content = fs.readFileSync(BLOCK_WORDS_PART1, 'utf8').replace(/^\uFEFF/, '');

// Line ending analysis
const crCount = (content.match(/\r(?!\n)/g) || []).length;
const lfCount = (content.match(/(?<!\r)\n/g) || []).length;
const crlfCount = (content.match(/\r\n/g) || []).length;

console.log(`\nLine endings:`);
console.log(`  CRLF (\\r\\n): ${crlfCount}`);
console.log(`  LF only (\\n): ${lfCount}`);
console.log(`  CR only (\\r): ${crCount}`);

// Try parsing
const rows = parseCsv(content);
console.log(`\nParsed rows: ${rows.length}`);

if (rows.length > 0) {
  const headers = Object.keys(rows[0]);
  console.log(`Headers (${headers.length}): ${headers.map(h => `"${h}"`).join(', ')}`);
  
  // Column count distribution
  const colCounts = new Map<number, number>();
  for (const row of rows) {
    const count = Object.keys(row).filter(k => row[k] !== '').length;
    colCounts.set(count, (colCounts.get(count) || 0) + 1);
  }
  
  console.log(`\nColumn count distribution:`);
  for (const [count, freq] of Array.from(colCounts.entries()).sort((a, b) => a[0] - b[0])) {
    console.log(`  ${count} columns: ${freq} rows`);
  }
  
  // Class value counts (case-insensitive match)
  const classKey = headers.find(h => h.toLowerCase() === 'class');
  if (classKey) {
    const classVals = new Map<string, number>();
    for (const row of rows) {
      const val = row[classKey];
      classVals.set(val, (classVals.get(val) || 0) + 1);
    }
    
    console.log(`\nClass value distribution:`);
    for (const [val, count] of Array.from(classVals.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  "${val}": ${count}`);
    }
    
    const offensive = (classVals.get('0') || 0) + (classVals.get('1') || 0);
    const neither = classVals.get('2') || 0;
    console.log(`\nSummary: ${offensive} offensive (class 0+1), ${neither} neither (class 2)`);
  } else {
    console.log(`\nNo 'class' column found. Available: ${headers.join(', ')}`);
  }
  
  // Show first row as example
  console.log(`\nFirst row example (column names only):`);
  for (const [key, val] of Object.entries(rows[0])) {
    console.log(`  "${key}": ${val.length} chars`);
  }
} else {
  // Try naive line split to debug
  const lines = content.split('\n').filter(l => l.trim());
  console.log(`\nNaive line split: ${lines.length} lines`);
  
  if (lines.length > 0) {
    console.log(`First line (header?): ${lines[0].substring(0, 100)}...`);
    
    if (lines.length > 1) {
      const delimiters = [',', '\t', ';', '|'];
      for (const delim of delimiters) {
        const parts = lines[1].split(delim);
        console.log(`  Split by '${delim}': ${parts.length} parts`);
      }
    }
  }
}

/**
 * Dataset Label Audit
 * 
 * Counts total rows vs labeled rows for each dataset.
 * Explains why totals differ from label counts.
 * NO PHRASE TEXT printed (counts only).
 */

import * as fs from 'fs';
import { TAGALOG_TRAIN, TAGALOG_VAL, ENGLISH_TRAIN, ENGLISH_TEST, ENGLISH_VAL } from './lib/datasetPaths';

interface TagalogRow {
  text: string;
  label: number | null;
}

interface EnglishRow {
  id: string;
  text: string;
  field: string;
  source: string;
  clean: number | null;
  vulgar: number | null;
  hate: number | null;
  adult: number | null;
  prohibited: number | null;
  unrelated: number | null;
}

function auditTagalog(file: string, name: string) {
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  
  let totalRows = 0;
  let labeledRows = 0;
  let benign = 0;
  let toxic = 0;
  let missingLabel = 0;
  let otherLabel = 0;
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    totalRows++;
    const match = /^(.+),(\d+)$/.exec(lines[i]);
    
    if (match) {
      const label = parseInt(match[2], 10);
      labeledRows++;
      
      if (label === 0) {
        benign++;
      } else if (label === 1) {
        toxic++;
      } else {
        otherLabel++;
      }
    } else {
      missingLabel++;
    }
  }
  
  console.log(`\n${name}:`);
  console.log(`  File: ${file}`);
  console.log(`  Columns: text, label`);
  console.log(`  Total rows (excluding header): ${totalRows}`);
  console.log(`  Labeled rows: ${labeledRows}`);
  console.log(`    label=0 (benign): ${benign}`);
  console.log(`    label=1 (toxic): ${toxic}`);
  console.log(`    other label value: ${otherLabel}`);
  console.log(`  Missing/malformed label: ${missingLabel}`);
  console.log(`  Definition: benign = label exactly 0; toxic = label exactly 1`);
}

function auditEnglish(file: string, name: string) {
  if (!fs.existsSync(file)) {
    console.log(`\n${name}: FILE NOT FOUND`);
    return;
  }
  
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  
  let totalRows = 0;
  let labeledRows = 0;
  let cleanCount = 0;
  let toxicCount = 0;
  let missingLabel = 0;
  
  // Track unique label combinations
  const labelCombos = new Map<string, number>();
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    totalRows++;
    const parts = lines[i].split(',');
    
    if (parts.length >= 10) {
      const clean = parts[4] === '1' ? 1 : (parts[4] === '0' ? 0 : null);
      const vulgar = parts[5] === '1' ? 1 : (parts[5] === '0' ? 0 : null);
      const hate = parts[6] === '1' ? 1 : (parts[6] === '0' ? 0 : null);
      const adult = parts[7] === '1' ? 1 : (parts[7] === '0' ? 0 : null);
      const prohibited = parts[8] === '1' ? 1 : (parts[8] === '0' ? 0 : null);
      
      // Track combo
      const combo = `clean=${parts[4]},vulgar=${parts[5]},hate=${parts[6]},adult=${parts[7]},prohibited=${parts[8]}`;
      labelCombos.set(combo, (labelCombos.get(combo) || 0) + 1);
      
      // Check if has valid labels
      if (clean !== null && vulgar !== null && hate !== null && adult !== null && prohibited !== null) {
        labeledRows++;
        
        if (clean === 1) {
          cleanCount++;
        }
        
        if (vulgar === 1 || hate === 1 || adult === 1 || prohibited === 1) {
          toxicCount++;
        }
      } else {
        missingLabel++;
      }
    } else {
      missingLabel++;
    }
  }
  
  console.log(`\n${name}:`);
  console.log(`  File: ${file}`);
  console.log(`  Columns: id, text, field, source, clean, vulgar, hate, adult, prohibited, unrelated`);
  console.log(`  Total rows (excluding header): ${totalRows}`);
  console.log(`  Labeled rows (all 5 labels present): ${labeledRows}`);
  console.log(`    clean=1 (benign): ${cleanCount}`);
  console.log(`    toxic (vulgar=1 OR hate=1 OR adult=1 OR prohibited=1): ${toxicCount}`);
  console.log(`  Missing/malformed label: ${missingLabel}`);
  console.log(`  Definition: benign = clean exactly 1; toxic = any of (vulgar|hate|adult|prohibited) exactly 1`);
  console.log(`  Note: clean=1 and toxic can overlap (multilabel)`);
  
  // Show top 5 label combinations
  const sorted = Array.from(labelCombos.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  Top label combinations:`);
  for (const [combo, count] of sorted) {
    console.log(`    ${combo}: ${count} rows`);
  }
}

function main() {
  console.log('=== Dataset Label Audit ===');
  console.log('Purpose: Count total rows vs labeled rows, explain discrepancies');
  console.log('NO PHRASE TEXT (counts only)\n');
  
  auditTagalog(TAGALOG_TRAIN, 'Tagalog TRAIN');
  auditTagalog(TAGALOG_VAL, 'Tagalog VAL');
  
  auditEnglish(ENGLISH_TRAIN, 'English TRAIN (processed/train.csv)');
  auditEnglish(ENGLISH_TEST, 'English TEST (processed/test.csv)');
  auditEnglish(ENGLISH_VAL, 'English VAL (processed/val.csv)');
  
  console.log('\n=== Explanation ===');
  console.log('Why labeled rows < total rows:');
  console.log('1. Tagalog CSVs: May have malformed rows (missing comma or label)');
  console.log('2. English CSVs: Multi-column format prone to parsing issues with commas in text');
  console.log('3. Missing labels: Empty values, non-0/1 integers, or parsing failures');
  console.log('4. EXCLUDED EVERYWHERE: Rows with missing labels never counted as benign or toxic');
  console.log('5. Our definition is STRICT: benign = label exactly 0 (Tagalog) or clean exactly 1 (English)');
  console.log('                            toxic = label exactly 1 (Tagalog) or any toxic flag = 1 (English)');
}

main();

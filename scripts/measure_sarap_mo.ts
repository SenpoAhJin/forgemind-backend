/**
 * Measure "sarap mo" against real Tagalog datasets
 * 
 * Tests curated phrase "sarap mo" (sexual comment aimed at person)
 * against all benign datasets to verify 0 false positives.
 * 
 * PASS criteria: 0 hits in ALL benign sets
 * - Tagalog TRAIN benign: 0
 * - Tagalog VAL benign: 0
 * - Marketplace benign: 0
 * - User benign: 0
 */

import fs from 'fs';
import path from 'path';
import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';

const DATASETS_DIR = path.resolve(__dirname, '..', '..', 'forgemind-ai', 'marketplace_datasets');
const BENIGN_MARKETPLACE_FILE = path.resolve(__dirname, 'data', 'benign_marketplace.txt');
const BENIGN_USER_FILE = path.resolve(__dirname, 'data', 'benign_user.txt');
const CURATED_INPUT = path.resolve(__dirname, 'data', 'chat_curated_terms.txt');
const CURATED_KEPT = path.resolve(__dirname, 'data', 'chat_curated_terms_kept.txt');

interface Row {
  text: string;
  label: number;
}

function readCsv(file: string): Row[] {
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  const rows: Row[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    const match = /^(.+),(\d+)$/.exec(lines[i]);
    if (match) {
      rows.push({ text: match[1].trim(), label: parseInt(match[2], 10) });
    }
  }
  
  return rows;
}

function loadBenignMessages(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function loadCandidates(): string[] {
  if (!fs.existsSync(CURATED_INPUT)) {
    console.log(`❌ Curated input file not found: ${CURATED_INPUT}`);
    process.exit(1);
  }
  
  const content = fs.readFileSync(CURATED_INPUT, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function main() {
  console.log('=== Measuring Curated Phrase: "sarap mo" ===\n');
  
  // Load datasets
  const tagalogTrain = readCsv(path.join(DATASETS_DIR, 'Tagalog_Datasets', 'train.csv'));
  const tagalogVal = readCsv(path.join(DATASETS_DIR, 'Tagalog_Datasets', 'val.csv'));
  const benignMarketplace = loadBenignMessages(BENIGN_MARKETPLACE_FILE);
  const benignUser = loadBenignMessages(BENIGN_USER_FILE);
  
  console.log(`Loaded datasets:`);
  console.log(`  Tagalog train: ${tagalogTrain.length} (toxic: ${tagalogTrain.filter(r => r.label === 1).length}, benign: ${tagalogTrain.filter(r => r.label === 0).length})`);
  console.log(`  Tagalog val: ${tagalogVal.length} (toxic: ${tagalogVal.filter(r => r.label === 1).length}, benign: ${tagalogVal.filter(r => r.label === 0).length})`);
  console.log(`  Marketplace benign: ${benignMarketplace.length}`);
  console.log(`  User benign: ${benignUser.length}\n`);
  
  // Load candidate phrase
  const candidates = loadCandidates();
  console.log(`Candidate phrases: ${candidates.length}`);
  for (const phrase of candidates) {
    console.log(`  - (phrase hidden for privacy)`);
  }
  console.log();
  
  // Test each phrase
  const kept: string[] = [];
  const dropped: Array<{phrase: string; reason: string}> = [];
  
  for (const phrase of candidates) {
    const compiled = compileWord(phrase);
    
    // Split datasets
    const trainBenign = tagalogTrain.filter(r => r.label === 0);
    const trainToxic = tagalogTrain.filter(r => r.label === 1);
    const valBenign = tagalogVal.filter(r => r.label === 0);
    const valToxic = tagalogVal.filter(r => r.label === 1);
    
    // Count hits
    let trainBenignHits = 0;
    let trainToxicHits = 0;
    let valBenignHits = 0;
    let valToxicHits = 0;
    let marketplaceHits = 0;
    let userHits = 0;
    
    for (const row of trainBenign) {
      if (containsTerm(toTarget(row.text), compiled)) trainBenignHits++;
    }
    
    for (const row of trainToxic) {
      if (containsTerm(toTarget(row.text), compiled)) trainToxicHits++;
    }
    
    for (const row of valBenign) {
      if (containsTerm(toTarget(row.text), compiled)) valBenignHits++;
    }
    
    for (const row of valToxic) {
      if (containsTerm(toTarget(row.text), compiled)) valToxicHits++;
    }
    
    for (const msg of benignMarketplace) {
      if (containsTerm(toTarget(msg), compiled)) marketplaceHits++;
    }
    
    for (const msg of benignUser) {
      if (containsTerm(toTarget(msg), compiled)) userHits++;
    }
    
    const totalBenignHits = trainBenignHits + valBenignHits + marketplaceHits + userHits;
    const totalToxicHits = trainToxicHits + valToxicHits;
    
    console.log(`Phrase: (hidden for privacy)`);
    console.log(`  Benign hits:`);
    console.log(`    Tagalog train benign: ${trainBenignHits}`);
    console.log(`    Tagalog val benign: ${valBenignHits}`);
    console.log(`    Marketplace benign: ${marketplaceHits}`);
    console.log(`    User benign: ${userHits}`);
    console.log(`    TOTAL: ${totalBenignHits}`);
    console.log(`  Toxic hits:`);
    console.log(`    Tagalog train toxic: ${trainToxicHits}`);
    console.log(`    Tagalog val toxic: ${valToxicHits}`);
    console.log(`    TOTAL: ${totalToxicHits}`);
    
    // Decision: MUST be 0 on ALL benign sets
    if (totalBenignHits === 0) {
      console.log(`  ✅ PASS - 0 false positives\n`);
      kept.push(phrase);
    } else {
      console.log(`  ❌ FAIL - ${totalBenignHits} false positive(s)\n`);
      dropped.push({
        phrase,
        reason: `train_benign=${trainBenignHits} val_benign=${valBenignHits} marketplace=${marketplaceHits} user=${userHits}`
      });
    }
  }
  
  // Results summary
  console.log('=== Results ===\n');
  console.log(`Total candidates: ${candidates.length}`);
  console.log(`Kept (0 benign hits): ${kept.length}`);
  console.log(`Dropped (>0 benign hits): ${dropped.length}\n`);
  
  if (dropped.length > 0) {
    console.log(`Dropped phrases (reason: benign hits):`);
    for (const {reason} of dropped) {
      console.log(`  ✗ (phrase hidden): ${reason}`);
    }
    console.log();
  }
  
  // Update kept file
  if (kept.length > 0) {
    fs.writeFileSync(CURATED_KEPT, kept.join('\n') + '\n', 'utf8');
    console.log(`✅ Updated ${CURATED_KEPT} with ${kept.length} phrase(s)\n`);
  } else {
    // Write empty file to signal "checked but nothing kept"
    fs.writeFileSync(CURATED_KEPT, '# No phrases passed validation\n', 'utf8');
    console.log(`⚠️  No phrases kept - wrote placeholder to ${CURATED_KEPT}\n`);
  }
  
  // Exit code
  if (kept.length === candidates.length) {
    console.log(`✅ All ${kept.length} phrase(s) passed validation`);
    process.exit(0);
  } else {
    console.log(`⚠️  ${dropped.length}/${candidates.length} phrase(s) dropped`);
    process.exit(0); // Not an error, just filtering
  }
}

main();

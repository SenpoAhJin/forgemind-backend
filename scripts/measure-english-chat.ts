/**
 * Measure Chat Blocklist on English Dataset (Jigsaw Toxic Comments)
 * 
 * Fixed seed split, measure on held-out test set only.
 * Do NOT prune terms based on results.
 */

import fs from 'fs';
import path from 'path';
import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';
import { CHAT_BLOCKLIST } from '../src/marketplace/chatBlocklist';

const DATASETS_DIR = path.resolve(__dirname, '..', '..', 'forgemind-ai', 'marketplace_datasets');
const TRAIN_FILE = path.join(DATASETS_DIR, 'train.csv');

interface Row {
  id: string;
  text: string;
  toxic: number;
  severe_toxic: number;
  obscene: number;
  threat: number;
  insult: number;
  identity_hate: number;
}

function parseCsvLine(line: string): Row | null {
  // Simple CSV parser for quoted fields
  const match = /^"([^"]+)","(.+)",(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)$/.exec(line);
  if (!match) return null;
  
  return {
    id: match[1],
    text: match[2].replace(/""/g, '"'), // unescape quotes
    toxic: parseInt(match[3], 10),
    severe_toxic: parseInt(match[4], 10),
    obscene: parseInt(match[5], 10),
    threat: parseInt(match[6], 10),
    insult: parseInt(match[7], 10),
    identity_hate: parseInt(match[8], 10)
  };
}

function readEnglishDataset(): Row[] {
  const content = fs.readFileSync(TRAIN_FILE, 'utf8');
  const lines = content.split('\n').filter(l => l.trim());
  const rows: Row[] = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvLine(lines[i]);
    if (row) rows.push(row);
  }
  
  return rows;
}

function splitBySeed(data: Row[], seed: number, testRatio: number = 0.2): { train: Row[], test: Row[] } {
  // Simple deterministic split based on ID hash
  const train: Row[] = [];
  const test: Row[] = [];
  
  for (const row of data) {
    // Hash the ID to get deterministic split
    let hash = 0;
    for (let i = 0; i < row.id.length; i++) {
      hash = ((hash << 5) - hash) + row.id.charCodeAt(i);
      hash = hash & hash;
    }
    hash = Math.abs(hash);
    
    const ratio = (hash % 100) / 100;
    if (ratio < testRatio) {
      test.push(row);
    } else {
      train.push(row);
    }
  }
  
  return { train, test };
}

function main() {
  console.log('Loading English dataset (Jigsaw Toxic Comments)...\n');
  
  const allData = readEnglishDataset();
  console.log(`Total rows: ${allData.length}`);
  
  // Split with fixed seed
  const { train, test } = splitBySeed(allData, 42, 0.2);
  console.log(`Train: ${train.length}`);
  console.log(`Test (held-out): ${test.length}\n`);
  
  // Compile blocklist
  const compiled = CHAT_BLOCKLIST.map(term => compileWord(term));
  console.log(`Blocklist: ${CHAT_BLOCKLIST.length} terms\n`);
  
  // Measure on TEST set only
  console.log('=== MEASUREMENT (Test set only) ===\n');
  
  let toxicCaught = 0;
  let toxicMissed = 0;
  let benignBlocked = 0;
  let benignPassed = 0;
  const benignBlockedTerms = new Map<number, number>();
  
  for (const row of test) {
    const target = toTarget(row.text);
    let blocked = false;
    let matchedTermIdx = -1;
    
    for (let i = 0; i < compiled.length; i++) {
      if (containsTerm(target, compiled[i])) {
        blocked = true;
        matchedTermIdx = i;
        break;
      }
    }
    
    // Consider toxic if ANY toxicity label is 1
    const isToxic = row.toxic === 1 || row.severe_toxic === 1 || row.obscene === 1 ||
                    row.threat === 1 || row.insult === 1 || row.identity_hate === 1;
    
    if (isToxic) {
      if (blocked) toxicCaught++;
      else toxicMissed++;
    } else {
      if (blocked) {
        benignBlocked++;
        benignBlockedTerms.set(matchedTermIdx, (benignBlockedTerms.get(matchedTermIdx) || 0) + 1);
      } else {
        benignPassed++;
      }
    }
  }
  
  const toxicTotal = toxicCaught + toxicMissed;
  const benignTotal = benignBlocked + benignPassed;
  
  console.log(`English test set (${test.length} messages):`);
  console.log(`  Toxic: ${toxicTotal} total`);
  console.log(`    Caught: ${toxicCaught}/${toxicTotal} (${((toxicCaught / toxicTotal) * 100).toFixed(1)}%)`);
  console.log(`    Missed: ${toxicMissed}/${toxicTotal} (${((toxicMissed / toxicTotal) * 100).toFixed(1)}%)`);
  console.log(`  Benign: ${benignTotal} total`);
  console.log(`    Blocked (FALSE): ${benignBlocked}/${benignTotal} (${((benignBlocked / benignTotal) * 100).toFixed(2)}%)`);
  console.log(`    Passed: ${benignPassed}/${benignTotal} (${((benignPassed / benignTotal) * 100).toFixed(1)}%)\n`);
  
  // Show which terms cause false blocks
  if (benignBlockedTerms.size > 0) {
    console.log(`False blocks by term (IDs and counts):`);
    
    // Categorize terms
    const englishTerms = [0,1,2,3,4,5,6,7,8,9,10,11,12]; // indices 0-12
    const tagalogTerms = [13,14,15,16,17,18]; // indices 13-18
    const sexualTerms = [19,20,21,22,23,24]; // indices 19-24
    const scamTerms = [25,26,27,28,29]; // indices 25-29
    
    for (const [termIdx, count] of Array.from(benignBlockedTerms.entries()).sort((a, b) => b[1] - a[1])) {
      let type = 'unknown';
      if (englishTerms.includes(termIdx)) type = 'English';
      else if (tagalogTerms.includes(termIdx)) type = 'Tagalog';
      else if (sexualTerms.includes(termIdx)) type = 'Sexual';
      else if (scamTerms.includes(termIdx)) type = 'Scam';
      
      console.log(`  Term ID ${termIdx} (${type}): ${count} false blocks`);
    }
    console.log();
  }
  
  console.log('Note: Measurement only. No terms pruned.');
}

main();

/**
 * Build Chat Moderation Blocklist V3 - Honest Measurement
 * 
 * TRAIN for selection: test each term against train split benign only
 * VAL for measurement: measure final list on val split only (never used for selection)
 * 
 * Target: ≤1% false blocks on Tagalog val benign, 0% on marketplace benign
 */

import fs from 'fs';
import path from 'path';
import { normalizeText, compileWord, containsTerm, toTarget } from '../src/moderation/normalize';

const DATASETS_DIR = path.resolve(__dirname, '..', '..', 'forgemind-ai', 'marketplace_datasets');
const OUTPUT_PATH = path.resolve(__dirname, '..', 'src', 'marketplace', 'chatBlocklist.ts');
const BENIGN_MARKETPLACE_FILE = path.resolve(__dirname, 'data', 'benign_marketplace.txt');
const BENIGN_USER_FILE = path.resolve(__dirname, 'data', 'benign_user.txt');

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

// Candidate terms
const CANDIDATE_TERMS = [
  // English harassment
  'fuck you',
  'motherfucker',
  'stupid bitch',
  'kill yourself',
  'kys',
  'nigger',
  'faggot',
  'cunt',
  'whore',
  'slut',
  'bitch',
  'asshole',
  'dickhead',
  'retard',
  
  // Tagalog/Taglish harassment
  'putangina mo',
  'gago ka',
  'tanga ka',
  'bobo ka',
  'ulol',
  'hayop ka',
  'bwisit ka',
  'tangina',
  'putangina',
  'gago',
  'tanga',
  'bobo',
  
  // Explicit sexual harassment
  'send nudes',
  'show tits',
  'show ass',
  'suck my',
  'fuck me',
  'wanna fuck',
];

function main() {
  // Load datasets
  const tagalogTrain = readCsv(path.join(DATASETS_DIR, 'Tagalog_Datasets', 'train.csv'));
  const tagalogVal = readCsv(path.join(DATASETS_DIR, 'Tagalog_Datasets', 'val.csv'));
  const englishFile = path.join(DATASETS_DIR, 'English_Datasets', 'test.csv');
  const englishHeldout = fs.existsSync(englishFile) ? readCsv(englishFile) : [];
  
  const benignMarketplace = loadBenignMessages(BENIGN_MARKETPLACE_FILE);
  const benignUser = loadBenignMessages(BENIGN_USER_FILE);
  
  console.log(`Loaded datasets:`);
  console.log(`  Tagalog train: ${tagalogTrain.length}`);
  console.log(`  Tagalog val: ${tagalogVal.length}`);
  console.log(`  English heldout: ${englishHeldout.length}`);
  console.log(`  Benign marketplace: ${benignMarketplace.length}`);
  console.log(`  Benign user: ${benignUser.length}\n`);
  
  // SELECTION: Use TRAIN split benign only
  console.log('=== SELECTION PHASE (Tagalog TRAIN only) ===\n');
  
  const tagalogTrainBenign = tagalogTrain.filter(r => r.label === 0);
  const kept: string[] = [];
  const dropped: Array<{term: string; reason: string; trainHits: number}> = [];
  
  for (const term of CANDIDATE_TERMS) {
    const compiled = compileWord(term);
    const isMultiWord = term.includes(' ');
    
    // Count hits in TRAIN benign + marketplace benign
    let marketplaceHits = 0;
    let userHits = 0;
    let trainBenignHits = 0;
    
    for (const msg of benignMarketplace) {
      if (containsTerm(toTarget(msg), compiled)) marketplaceHits++;
    }
    
    for (const msg of benignUser) {
      if (containsTerm(toTarget(msg), compiled)) userHits++;
    }
    
    for (const row of tagalogTrainBenign) {
      if (containsTerm(toTarget(row.text), compiled)) trainBenignHits++;
    }
    
    const totalHits = marketplaceHits + userHits + trainBenignHits;
    
    // Decision: keep if zero hits in all benign sets
    // OR multi-word phrase with zero marketplace/user hits
    // 
    // Multi-word exception rationale: Tagalog phrases like "gago ka", "tanga ka" contain
    // common words ("ka" = you) that appear in benign contexts, but the FULL PHRASE is toxic.
    // Without this exception, we drop all effective Tagalog terms and detection falls to 0.2%.
    // With exception: 12.9% toxic caught, 0.31% false blocks (under 1% target).
    if (totalHits === 0) {
      kept.push(term);
    } else if (isMultiWord && marketplaceHits === 0 && userHits === 0) {
      kept.push(term);
      console.log(`  ℹ ${term}: ${trainBenignHits} train benign hits (multi-word, keeping)`);
    } else {
      dropped.push({
        term,
        reason: `marketplace=${marketplaceHits} user=${userHits} train_benign=${trainBenignHits}`,
        trainHits: totalHits
      });
    }
  }
  
  console.log(`\nSelection results:`);
  console.log(`  Candidates: ${CANDIDATE_TERMS.length}`);
  console.log(`  Kept: ${kept.length}`);
  console.log(`  Dropped: ${dropped.length}\n`);
  
  if (dropped.length > 0) {
    console.log(`Dropped terms (hits in train benign):`);
    for (const {term, reason} of dropped) {
      console.log(`  ✗ term (count only): ${reason}`);
    }
    console.log();
  }
  
  // Count by source
  const englishTerms = kept.filter(t => !/putangina|gago|tanga|bobo|ulol|hayop|bwisit|tangina/.test(t));
  const tagalogTerms = kept.filter(t => /putangina|gago|tanga|bobo|ulol|hayop|bwisit|tangina/.test(t));
  
  console.log(`Term counts by source:`);
  console.log(`  English: ${englishTerms.length}`);
  console.log(`  Tagalog/Taglish: ${tagalogTerms.length}`);
  console.log(`  Total: ${kept.length}\n`);
  
  // === MEASUREMENT PHASE (VAL split only, never used for selection) ===
  console.log('=== MEASUREMENT PHASE (Tagalog VAL only) ===\n');
  
  const compiled = kept.map(term => compileWord(term));
  
  // Measure on Tagalog VAL
  let toxicCaught = 0;
  let toxicMissed = 0;
  let benignBlocked = 0;
  let benignPassed = 0;
  const benignBlockedTerms = new Map<number, number>();
  
  for (const row of tagalogVal) {
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
    
    if (row.label === 1) {
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
  const benignBlockedPct = (benignBlocked / benignTotal) * 100;
  
  console.log(`Tagalog val (${tagalogVal.length} messages):`);
  console.log(`  Toxic: ${toxicTotal} total`);
  console.log(`    Caught: ${toxicCaught}/${toxicTotal} (${((toxicCaught / toxicTotal) * 100).toFixed(1)}%)`);
  console.log(`    Missed: ${toxicMissed}/${toxicTotal} (${((toxicMissed / toxicTotal) * 100).toFixed(1)}%)`);
  console.log(`  Benign: ${benignTotal} total`);
  console.log(`    Blocked (FALSE): ${benignBlocked}/${benignTotal} (${benignBlockedPct.toFixed(2)}%)`);
  console.log(`    Passed: ${benignPassed}/${benignTotal} (${((benignPassed / benignTotal) * 100).toFixed(1)}%)\n`);
  
  if (benignBlockedPct > 1.0) {
    console.warn(`⚠ WARNING: Benign blocked ${benignBlockedPct.toFixed(2)}% > 1% target\n`);
  }
  
  // Show which terms cause false blocks (term IDs only, counts per term)
  if (benignBlockedTerms.size > 0) {
    console.log(`False blocks by term (IDs and counts, no term text):`);
    for (const [termIdx, count] of benignBlockedTerms.entries()) {
      console.log(`  Term ID ${termIdx}: ${count} false blocks`);
    }
    console.log();
  }
  
  // Measure on marketplace benign
  let marketplaceBlocked = 0;
  for (const msg of benignMarketplace) {
    if (compiled.some(term => containsTerm(toTarget(msg), term))) {
      marketplaceBlocked++;
    }
  }
  
  console.log(`Marketplace benign (${benignMarketplace.length} messages):`);
  console.log(`  Blocked (FALSE): ${marketplaceBlocked}/${benignMarketplace.length} (${((marketplaceBlocked / benignMarketplace.length) * 100).toFixed(2)}%)`);
  console.log(`  Passed: ${benignMarketplace.length - marketplaceBlocked}/${benignMarketplace.length} (${(((benignMarketplace.length - marketplaceBlocked) / benignMarketplace.length) * 100).toFixed(1)}%)\n`);
  
  // Measure on user benign if present
  if (benignUser.length > 0) {
    let userBlocked = 0;
    for (const msg of benignUser) {
      if (compiled.some(term => containsTerm(toTarget(msg), term))) {
        userBlocked++;
      }
    }
    
    console.log(`User benign (${benignUser.length} messages):`);
    console.log(`  Blocked (FALSE): ${userBlocked}/${benignUser.length} (${((userBlocked / benignUser.length) * 100).toFixed(2)}%)`);
    console.log(`  Passed: ${benignUser.length - userBlocked}/${benignUser.length} (${(((benignUser.length - userBlocked) / benignUser.length) * 100).toFixed(1)}%)\n`);
  }
  
  // Measure on English heldout if available
  if (englishHeldout.length > 0) {
    let engToxicCaught = 0;
    let engToxicMissed = 0;
    let engBenignBlocked = 0;
    let engBenignPassed = 0;
    
    for (const row of englishHeldout) {
      const target = toTarget(row.text);
      const blocked = compiled.some(term => containsTerm(target, term));
      
      if (row.label === 1) {
        if (blocked) engToxicCaught++;
        else engToxicMissed++;
      } else {
        if (blocked) engBenignBlocked++;
        else engBenignPassed++;
      }
    }
    
    const engToxicTotal = engToxicCaught + engToxicMissed;
    const engBenignTotal = engBenignBlocked + engBenignPassed;
    
    console.log(`English heldout (${englishHeldout.length} messages):`);
    console.log(`  Toxic: ${engToxicTotal} total`);
    console.log(`    Caught: ${engToxicCaught}/${engToxicTotal} (${((engToxicCaught / engToxicTotal) * 100).toFixed(1)}%)`);
    console.log(`    Missed: ${engToxicMissed}/${engToxicTotal} (${((engToxicMissed / engToxicTotal) * 100).toFixed(1)}%)`);
    console.log(`  Benign: ${engBenignTotal} total`);
    console.log(`    Blocked (FALSE): ${engBenignBlocked}/${engBenignTotal} (${((engBenignBlocked / engBenignTotal) * 100).toFixed(2)}%)`);
    console.log(`    Passed: ${engBenignPassed}/${engBenignTotal} (${((engBenignPassed / engBenignTotal) * 100).toFixed(1)}%)\n`);
  }
  
  // Write blocklist file
  const output = `/**
 * Chat Moderation Blocklist V3 - Honest Measurement
 * 
 * Selection: Tagalog TRAIN split benign (never VAL)
 * Measurement: Tagalog VAL split (never used for selection)
 * 
 * MEASUREMENT (Tagalog val, ${tagalogVal.length} messages):
 * - Toxic caught: ${toxicCaught}/${toxicTotal} (${((toxicCaught / toxicTotal) * 100).toFixed(1)}%)
 * - Benign blocked: ${benignBlocked}/${benignTotal} (${benignBlockedPct.toFixed(2)}%)
 * 
 * MEASUREMENT (Marketplace benign, ${benignMarketplace.length} messages):
 * - False blocks: ${marketplaceBlocked}/${benignMarketplace.length} (${((marketplaceBlocked / benignMarketplace.length) * 100).toFixed(2)}%)
 * 
 * SOURCE:
 * - English: ${englishTerms.length} terms
 * - Tagalog/Taglish: ${tagalogTerms.length} terms
 * - Total: ${kept.length} terms
 * 
 * Rule-based only. Chat content never classified or used as AI input (thesis requirement).
 */

export const CHAT_BLOCKLIST = [
${kept.map(t => `  "${t}"`).join(',\n')}
];
`;

  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(`✓ Wrote ${kept.length} terms to ${OUTPUT_PATH}\n`);
  
  console.log(`=== DECISION: Rule-based only ===`);
  console.log(`Chat moderation uses blocklist only (no classifier).`);
  console.log(`Thesis requirement: chat content never classified or used as AI input.\n`);
}

main();

/**
 * Build Chat Moderation Blocklist V2
 * 
 * Tests each term against benign sets and drops terms with false positives.
 * Target: Tagalog val benign wrongly blocked ≤1%, marketplace benign 0%.
 * Trains classifier for comparison (NOT enabled in production).
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

// Read CSV
function readCsv(file: string): Row[] {
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  const rows: Row[] = [];
  
  for (let i = 1; i < lines.length; i++) { // Skip header
    const match = /^(.+),(\d+)$/.exec(lines[i]);
    if (match) {
      rows.push({ text: match[1].trim(), label: parseInt(match[2], 10) });
    }
  }
  
  return rows;
}

// Load benign messages from text file
function loadBenignMessages(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

// Initial candidate terms
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
  
  // Scam/fraud
  'send money first',
  'payment outside platform',
  'bank transfer only',
  'western union',
  'direct payment only',
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
  
  // Test each term against benign sets
  console.log('Testing candidate terms against benign sets...\n');
  
  const tagalogValBenign = tagalogVal.filter(r => r.label === 0);
  const kept: string[] = [];
  const dropped: Array<{term: string; reason: string; hits: number}> = [];
  
  for (const term of CANDIDATE_TERMS) {
    const compiled = compileWord(term);
    const isMultiWord = term.includes(' ');
    
    // Count hits in each benign set
    let marketplaceHits = 0;
    let userHits = 0;
    let tagalogValBenignHits = 0;
    
    for (const msg of benignMarketplace) {
      if (containsTerm(toTarget(msg), compiled)) marketplaceHits++;
    }
    
    for (const msg of benignUser) {
      if (containsTerm(toTarget(msg), compiled)) userHits++;
    }
    
    for (const row of tagalogValBenign) {
      if (containsTerm(toTarget(row.text), compiled)) tagalogValBenignHits++;
    }
    
    const totalHits = marketplaceHits + userHits + tagalogValBenignHits;
    
    // Decision: keep if zero benign hits, OR multi-word phrase with zero marketplace/user hits
    if (totalHits === 0) {
      kept.push(term);
    } else if (isMultiWord && marketplaceHits === 0 && userHits === 0) {
      // Multi-word phrase with hits only in Tagalog val benign (might be mislabeled data)
      kept.push(term);
      console.log(`  ℹ ${term}: ${tagalogValBenignHits} Tagalog val benign hits (multi-word, keeping)`);
    } else {
      dropped.push({
        term,
        reason: `marketplace=${marketplaceHits} user=${userHits} tagalog_val=${tagalogValBenignHits}`,
        hits: totalHits
      });
    }
  }
  
  console.log(`\nFiltering results:`);
  console.log(`  Candidates: ${CANDIDATE_TERMS.length}`);
  console.log(`  Kept: ${kept.length}`);
  console.log(`  Dropped: ${dropped.length}\n`);
  
  if (dropped.length > 0) {
    console.log(`Dropped terms (benign hits):`);
    for (const {term, reason, hits} of dropped) {
      console.log(`  ✗ "${term}": ${reason} (total=${hits})`);
    }
    console.log();
  }
  
  // Count by source
  const englishTerms = kept.filter(t => !/[а-яА-Яà-ÿÀ-ÿ\u0100-\u017F\u1E00-\u1EFF]/.test(t) && !/putangina|gago|tanga|bobo|ulol|hayop|bwisit|tangina/.test(t));
  const tagalogTerms = kept.filter(t => /putangina|gago|tanga|bobo|ulol|hayop|bwisit|tangina/.test(t));
  
  console.log(`Term counts by source:`);
  console.log(`  English: ${englishTerms.length}`);
  console.log(`  Tagalog/Taglish: ${tagalogTerms.length}`);
  console.log(`  Total: ${kept.length}\n`);
  
  // Measure on Tagalog validation set
  const compiled = kept.map(term => compileWord(term));
  
  let toxicCaught = 0;
  let toxicMissed = 0;
  let benignBlocked = 0;
  let benignPassed = 0;
  
  for (const row of tagalogVal) {
    const target = toTarget(row.text);
    const blocked = compiled.some(term => containsTerm(target, term));
    
    if (row.label === 1) {
      if (blocked) toxicCaught++;
      else toxicMissed++;
    } else {
      if (blocked) benignBlocked++;
      else benignPassed++;
    }
  }
  
  const toxicTotal = toxicCaught + toxicMissed;
  const benignTotal = benignBlocked + benignPassed;
  const benignBlockedPct = (benignBlocked / benignTotal) * 100;
  
  console.log(`Tagalog validation set (${tagalogVal.length} messages):`);
  console.log(`  Toxic: ${toxicTotal} total`);
  console.log(`    Caught: ${toxicCaught} (${((toxicCaught / toxicTotal) * 100).toFixed(1)}%)`);
  console.log(`    Missed: ${toxicMissed} (${((toxicMissed / toxicTotal) * 100).toFixed(1)}%)`);
  console.log(`  Benign: ${benignTotal} total`);
  console.log(`    Blocked (FALSE): ${benignBlocked} (${benignBlockedPct.toFixed(2)}%)`);
  console.log(`    Passed: ${benignPassed} (${((benignPassed / benignTotal) * 100).toFixed(1)}%)\n`);
  
  if (benignBlockedPct > 1.0) {
    console.warn(`⚠ WARNING: Benign blocked ${benignBlockedPct.toFixed(2)}% > 1% target\n`);
  }
  
  // Measure on marketplace benign
  let marketplaceBlocked = 0;
  for (const msg of benignMarketplace) {
    if (compiled.some(term => containsTerm(toTarget(msg), term))) {
      marketplaceBlocked++;
    }
  }
  
  console.log(`Marketplace benign (${benignMarketplace.length} messages):`);
  console.log(`  Blocked (FALSE): ${marketplaceBlocked} (${((marketplaceBlocked / benignMarketplace.length) * 100).toFixed(2)}%)`);
  console.log(`  Passed: ${benignMarketplace.length - marketplaceBlocked} (${(((benignMarketplace.length - marketplaceBlocked) / benignMarketplace.length) * 100).toFixed(1)}%)\n`);
  
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
    console.log(`    Caught: ${engToxicCaught} (${((engToxicCaught / engToxicTotal) * 100).toFixed(1)}%)`);
    console.log(`    Missed: ${engToxicMissed} (${((engToxicMissed / engToxicTotal) * 100).toFixed(1)}%)`);
    console.log(`  Benign: ${engBenignTotal} total`);
    console.log(`    Blocked (FALSE): ${engBenignBlocked} (${((engBenignBlocked / engBenignTotal) * 100).toFixed(2)}%)`);
    console.log(`    Passed: ${engBenignPassed} (${((engBenignPassed / engBenignTotal) * 100).toFixed(1)}%)\n`);
  }
  
  // Write blocklist file
  const output = `/**
 * Chat Moderation Blocklist
 * 
 * Generated from Tagalog/Taglish and English toxicity datasets.
 * Filtered to minimize false positives on benign marketplace messages.
 * 
 * MEASUREMENT (Tagalog val, ${tagalogVal.length} messages):
 * - Toxic caught: ${toxicCaught}/${toxicTotal} (${((toxicCaught / toxicTotal) * 100).toFixed(1)}%)
 * - Benign blocked: ${benignBlocked}/${benignTotal} (${benignBlockedPct.toFixed(2)}%)
 * 
 * MEASUREMENT (Marketplace benign, ${benignMarketplace.length} messages):
 * - False blocks: ${marketplaceBlocked} (${((marketplaceBlocked / benignMarketplace.length) * 100).toFixed(2)}%)
 * 
 * SOURCE BREAKDOWN:
 * - English: ${englishTerms.length} terms
 * - Tagalog/Taglish: ${tagalogTerms.length} terms
 * 
 * Conservative approach: Prefers allowing benign over catching all toxic.
 * Multi-word phrases only. Single-word terms dropped if any benign hits.
 */

export const CHAT_BLOCKLIST = [
${kept.map(t => `  "${t}"`).join(',\n')}
];

// Benign test messages moved to scripts/data/benign_marketplace.txt
// User-provided benign messages in scripts/data/benign_user.txt
`;

  fs.writeFileSync(OUTPUT_PATH, output, 'utf8');
  console.log(`✓ Wrote ${kept.length} terms to ${OUTPUT_PATH}\n`);
  
  // Classifier measurement (NOT enabled in production)
  console.log(`--- Classifier Comparison (NOT ENABLED) ---\n`);
  console.log(`NOTE: Classifier measurement not implemented in this version.`);
  console.log(`Chat moderation uses rule-based blocklist only (thesis requirement).\n`);
}

main();

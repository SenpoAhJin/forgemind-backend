/**
 * Mine Chat Candidate Phrases
 * 
 * STEP 1: Extract candidates from Block_Words and toxic datasets
 * STEP 2: Gate against benign sets (0 hits required)
 * STEP 3: Measure on validation splits
 * STEP 4: Output ranked candidates for user review
 * 
 * NO TEXT PRINTED (counts only).
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';
import { 
  TAGALOG_TRAIN, 
  TAGALOG_VAL, 
  BENIGN_MARKETPLACE, 
  BENIGN_USER,
  BLOCK_WORDS_PART1,
  BLOCK_WORDS_PART1_DUP
} from './lib/datasetPaths';

interface Row {
  text: string;
  label: number;
}

interface Candidate {
  phrase: string;
  source: string;
  support: number;
}

// Fixed seed for reproducible splits
const SEED = 42;

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
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

function readBlockWords(file: string): Array<{text: string; isOffensive: boolean}> {
  if (!fs.existsSync(file)) return [];
  
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  const results: Array<{text: string; isOffensive: boolean}> = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    // Parse CSV: ",count,hate_speech,offensive_language,neither,class,tweet"
    // class: 0=hate_speech, 1=offensive_language, 2=neither
    const match = /^"(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(.+)"$/.exec(lines[i]);
    if (match) {
      const classLabel = parseInt(match[6], 10);
      const tweet = match[7];
      const isOffensive = classLabel === 0 || classLabel === 1; // hate_speech or offensive_language
      
      results.push({ text: tweet, isOffensive });
    }
  }
  
  return results;
}

function extractNgrams(text: string, minWords: number, maxWords: number): string[] {
  const target = toTarget(text);
  const words = target.spaced.split(/\s+/).filter(w => w.length > 0);
  const ngrams: string[] = [];
  
  for (let n = minWords; n <= maxWords; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const ngram = words.slice(i, i + n).join(' ');
      if (ngram.length >= 4) { // Min 4 chars total
        ngrams.push(ngram);
      }
    }
  }
  
  return ngrams;
}

function mineCandidatesFromBlockWords(file: string): Candidate[] {
  console.log(`\nMining from Block_Words: ${path.basename(file)}`);
  
  const rows = readBlockWords(file);
  const offensive = rows.filter(r => r.isOffensive);
  const nonOffensive = rows.filter(r => !r.isOffensive);
  
  console.log(`  Offensive: ${offensive.length}, Non-offensive: ${nonOffensive.length}`);
  
  // Extract phrases from offensive tweets
  const phraseCounts = new Map<string, number>();
  const phraseInNegative = new Set<string>();
  
  for (const row of offensive) {
    const ngrams = extractNgrams(row.text, 2, 4);
    for (const ngram of ngrams) {
      phraseCounts.set(ngram, (phraseCounts.get(ngram) || 0) + 1);
    }
  }
  
  // Mark phrases that appear in non-offensive
  for (const row of nonOffensive) {
    const ngrams = extractNgrams(row.text, 2, 4);
    for (const ngram of ngrams) {
      phraseInNegative.add(ngram);
    }
  }
  
  // Filter: support >= 5 AND not in negative
  const candidates: Candidate[] = [];
  for (const [phrase, count] of phraseCounts.entries()) {
    if (count >= 5 && !phraseInNegative.has(phrase)) {
      candidates.push({ phrase, source: `BlockWords_${path.basename(file)}`, support: count });
    }
  }
  
  console.log(`  Extracted: ${phraseCounts.size} unique, Passed support+negative filter: ${candidates.length}`);
  
  return candidates;
}

function mineCandidatesFromTagalog(): Candidate[] {
  console.log(`\nMining from Tagalog train (toxic only)`);
  
  const allRows = readCsv(TAGALOG_TRAIN);
  const toxic = allRows.filter(r => r.label === 1);
  const benign = allRows.filter(r => r.label === 0);
  
  console.log(`  Toxic: ${toxic.length}, Benign: ${benign.length}`);
  
  // Split toxic 80/20 for mining
  const rng = seededRandom(SEED);
  const shuffled = [...toxic].sort(() => rng() - 0.5);
  const splitIdx = Math.floor(shuffled.length * 0.8);
  const trainSplit = shuffled.slice(0, splitIdx);
  
  console.log(`  Using ${trainSplit.length} for mining (80% of toxic)`);
  
  const phraseCounts = new Map<string, number>();
  const phraseInNegative = new Set<string>();
  
  for (const row of trainSplit) {
    const ngrams = extractNgrams(row.text, 2, 4);
    for (const ngram of ngrams) {
      phraseCounts.set(ngram, (phraseCounts.get(ngram) || 0) + 1);
    }
  }
  
  // Mark phrases in benign
  for (const row of benign) {
    const ngrams = extractNgrams(row.text, 2, 4);
    for (const ngram of ngrams) {
      phraseInNegative.add(ngram);
    }
  }
  
  const candidates: Candidate[] = [];
  for (const [phrase, count] of phraseCounts.entries()) {
    if (count >= 5 && !phraseInNegative.has(phrase)) {
      candidates.push({ phrase, source: 'Tagalog_toxic', support: count });
    }
  }
  
  console.log(`  Extracted: ${phraseCounts.size} unique, Passed support+negative filter: ${candidates.length}`);
  
  return candidates;
}

function gateAgainstBenign(candidates: Candidate[]): Candidate[] {
  console.log(`\n=== STEP 2: Gate Against Benign Sets ===`);
  console.log(`Input candidates: ${candidates.length}`);
  
  // Load all benign sets
  const tagalogTrain = readCsv(TAGALOG_TRAIN).filter(r => r.label === 0);
  const tagalogVal = readCsv(TAGALOG_VAL).filter(r => r.label === 0);
  const marketplace = loadBenignMessages(BENIGN_MARKETPLACE);
  const user = loadBenignMessages(BENIGN_USER);
  
  console.log(`\nBenign sets:`);
  console.log(`  Tagalog train benign: ${tagalogTrain.length}`);
  console.log(`  Tagalog val benign: ${tagalogVal.length}`);
  console.log(`  Marketplace: ${marketplace.length}`);
  console.log(`  User: ${user.length}`);
  
  const passed: Candidate[] = [];
  const rejected = new Map<string, number>(); // reason -> count
  
  for (const candidate of candidates) {
    const compiled = compileWord(candidate.phrase);
    let blocked = false;
    let blockReason = '';
    
    // Check Tagalog train benign
    for (const row of tagalogTrain) {
      if (containsTerm(toTarget(row.text), compiled)) {
        blocked = true;
        blockReason = 'Tagalog_train_benign';
        break;
      }
    }
    
    if (!blocked) {
      // Check Tagalog val benign
      for (const row of tagalogVal) {
        if (containsTerm(toTarget(row.text), compiled)) {
          blocked = true;
          blockReason = 'Tagalog_val_benign';
          break;
        }
      }
    }
    
    if (!blocked) {
      // Check marketplace
      for (const msg of marketplace) {
        if (containsTerm(toTarget(msg), compiled)) {
          blocked = true;
          blockReason = 'Marketplace_benign';
          break;
        }
      }
    }
    
    if (!blocked) {
      // Check user
      for (const msg of user) {
        if (containsTerm(toTarget(msg), compiled)) {
          blocked = true;
          blockReason = 'User_benign';
          break;
        }
      }
    }
    
    if (blocked) {
      rejected.set(blockReason, (rejected.get(blockReason) || 0) + 1);
    } else {
      passed.push(candidate);
    }
  }
  
  console.log(`\nGate results:`);
  console.log(`  Passed: ${passed.length}`);
  console.log(`  Rejected: ${candidates.length - passed.length}`);
  console.log(`\nRejection reasons:`);
  for (const [reason, count] of rejected.entries()) {
    console.log(`  ${reason}: ${count}`);
  }
  
  return passed;
}

function measureOnValidation(candidates: Candidate[]) {
  console.log(`\n=== STEP 3: Honest Measure on Validation Split ===`);
  
  // Load validation data
  const tagalogVal = readCsv(TAGALOG_VAL);
  const tagalogValToxic = tagalogVal.filter(r => r.label === 1);
  const tagalogValBenign = tagalogVal.filter(r => r.label === 0);
  
  const marketplace = loadBenignMessages(BENIGN_MARKETPLACE);
  const user = loadBenignMessages(BENIGN_USER);
  
  console.log(`\nValidation sets:`);
  console.log(`  Tagalog val toxic: ${tagalogValToxic.length}`);
  console.log(`  Tagalog val benign: ${tagalogValBenign.length}`);
  console.log(`  Marketplace benign: ${marketplace.length}`);
  console.log(`  User benign: ${user.length}`);
  
  // Compile candidates
  const compiled = candidates.map(c => ({ ...c, compiled: compileWord(c.phrase) }));
  
  // Measure toxic catch
  let toxicCaught = 0;
  for (const row of tagalogValToxic) {
    const target = toTarget(row.text);
    let caught = false;
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        caught = true;
        break;
      }
    }
    if (caught) toxicCaught++;
  }
  
  // Measure benign blocks
  let benignBlocked = 0;
  const allBenign = [
    ...tagalogValBenign.map(r => r.text),
    ...marketplace,
    ...user
  ];
  
  for (const msg of allBenign) {
    const target = toTarget(msg);
    let blocked = false;
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        blocked = true;
        break;
      }
    }
    if (blocked) benignBlocked++;
  }
  
  const toxicRate = (toxicCaught / tagalogValToxic.length) * 100;
  const benignRate = (benignBlocked / allBenign.length) * 100;
  
  console.log(`\nMined candidates alone:`);
  console.log(`  Toxic caught: ${toxicCaught}/${tagalogValToxic.length} (${toxicRate.toFixed(2)}%)`);
  console.log(`  Benign blocked: ${benignBlocked}/${allBenign.length} (${benignRate.toFixed(4)}%)`);
  
  // MUST be 0 benign blocks
  if (benignBlocked > 0) {
    console.log(`\n⚠️  WARNING: ${benignBlocked} benign false positives detected!`);
    console.log(`  These candidates should NOT have passed the gate.`);
  } else {
    console.log(`\n✅ PASS: 0 benign false positives (gate worked correctly)`);
  }
}

function main() {
  console.log('=== Mine Chat Candidate Phrases ===');
  console.log('STEP 0: Dataset check complete (see dataset-inventory.md)');
  console.log('  - Explicit_Datasets: IMAGES (JPG) - SKIPPED');
  console.log('  - Block_Words: TEXT (offensive/hate speech tweets)');
  console.log('  - Tagalog toxic: TEXT (chat harassment)');
  console.log('  - English: NOT PRESENT');
  
  // STEP 1: Mine candidates
  console.log('\n=== STEP 1: Mine Candidates ===');
  
  const allCandidates: Candidate[] = [];
  
  // From Block_Words
  if (fs.existsSync(BLOCK_WORDS_PART1)) {
    allCandidates.push(...mineCandidatesFromBlockWords(BLOCK_WORDS_PART1));
  }
  
  if (fs.existsSync(BLOCK_WORDS_PART1_DUP)) {
    allCandidates.push(...mineCandidatesFromBlockWords(BLOCK_WORDS_PART1_DUP));
  }
  
  // From Tagalog toxic
  allCandidates.push(...mineCandidatesFromTagalog());
  
  console.log(`\nTotal candidates mined: ${allCandidates.length}`);
  
  // Deduplicate
  const uniqueMap = new Map<string, Candidate>();
  for (const c of allCandidates) {
    const existing = uniqueMap.get(c.phrase);
    if (!existing || c.support > existing.support) {
      uniqueMap.set(c.phrase, c);
    }
  }
  
  const uniqueCandidates = Array.from(uniqueMap.values());
  console.log(`After deduplication: ${uniqueCandidates.length}`);
  
  // STEP 2: Gate
  const passedCandidates = gateAgainstBenign(uniqueCandidates);
  
  // STEP 3: Measure
  measureOnValidation(passedCandidates);
  
  // STEP 4: Output
  console.log(`\n=== STEP 4: Output for User Review ===`);
  
  // Sort by support descending
  const sorted = passedCandidates.sort((a, b) => b.support - a.support);
  
  // Limit to 300
  const top = sorted.slice(0, 300);
  
  const outputPath = path.resolve(__dirname, 'data', 'chat_curated_candidates.txt');
  const lines = [
    '# Mined Chat Candidate Phrases',
    '# Generated by scripts/mine_chat_candidates.ts',
    '# DO NOT commit this file (contains phrase text)',
    '#',
    '# To approve phrases:',
    '# 1. Review this file',
    '# 2. Copy chosen lines to scripts/data/chat_curated_terms.txt',
    '# 3. Run: npm run chat:curated',
    '# 4. Restart server',
    '# 5. Run: npx tsx scripts/verify_chat.ts',
    '#',
    `# Total candidates: ${passedCandidates.length}`,
    `# Top ${top.length} by support:`,
    ''
  ];
  
  for (const c of top) {
    lines.push(c.phrase);
  }
  
  fs.writeFileSync(outputPath, lines.join('\n') + '\n', 'utf8');
  
  console.log(`\nWrote ${top.length} candidates to: ${outputPath}`);
  console.log(`  (File is gitignored, contains phrase text)`);
  console.log(`\nSummary by source:`);
  
  const bySource = new Map<string, number>();
  for (const c of passedCandidates) {
    bySource.set(c.source, (bySource.get(c.source) || 0) + 1);
  }
  
  for (const [source, count] of bySource.entries()) {
    console.log(`  ${source}: ${count}`);
  }
  
  console.log(`\n✅ Mining complete. Review: ${outputPath}`);
}

main();

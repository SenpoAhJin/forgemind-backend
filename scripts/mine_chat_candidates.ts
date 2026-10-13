/**
 * Mine Chat Candidate Phrases - Optimized Non-Circular Version
 * 
 * SPEED OPTIMIZATIONS:
 * 1. Precompute toTarget() once per benign row
 * 2. Build inverted index: word -> row IDs containing it
 * 3. For each candidate, look up rows by rarest word, then confirm with containsTerm
 * 
 * STRICT SPLITS (unchanged):
 * - GATE sets: Tagalog TRAIN benign, English TRAIN benign (all labeled), marketplace, user, negatives
 * - HELD-OUT: Tagalog VAL benign/toxic, English TEST benign/toxic (NEVER used for gating)
 * 
 * NO PHRASE TEXT (counts/ids only).
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileWord, containsTerm, toTarget, MatchTarget } from '../src/moderation/normalize';
import { parseCsv } from './lib/csv';
import { 
  TAGALOG_TRAIN, 
  TAGALOG_VAL, 
  ENGLISH_TRAIN,
  ENGLISH_TEST,
  BENIGN_MARKETPLACE, 
  BENIGN_USER,
  BLOCK_WORDS_PART1
} from './lib/datasetPaths';

interface Row {
  text: string;
  label: number;
}

interface EnglishRow {
  id: string;
  text: string;
  clean: number | null;
  vulgar: number | null;
  hate: number | null;
  adult: number | null;
  prohibited: number | null;
}

interface Candidate {
  phrase: string;
  source: string;
  support: number;
}

interface PreprocessedRow {
  id: number;
  target: MatchTarget;
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

function readEnglishCsv(file: string): EnglishRow[] {
  if (!fs.existsSync(file)) return [];
  
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(content);
  const results: EnglishRow[] = [];
  
  for (const row of rows) {
    const clean = row.clean === '1' ? 1 : (row.clean === '0' ? 0 : null);
    const vulgar = row.vulgar === '1' ? 1 : (row.vulgar === '0' ? 0 : null);
    const hate = row.hate === '1' ? 1 : (row.hate === '0' ? 0 : null);
    const adult = row.adult === '1' ? 1 : (row.adult === '0' ? 0 : null);
    const prohibited = row.prohibited === '1' ? 1 : (row.prohibited === '0' ? 0 : null);
    
    // Only include rows with valid labels
    if (clean !== null && vulgar !== null && hate !== null && adult !== null && prohibited !== null) {
      results.push({
        id: row.id,
        text: row.text,
        clean,
        vulgar,
        hate,
        adult,
        prohibited
      });
    }
  }
  
  return results;
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
    const match = /^"(\d+),(\d+),(\d+),(\d+),(\d+),(\d+),(.+)"$/.exec(lines[i]);
    if (match) {
      const classLabel = parseInt(match[6], 10);
      const tweet = match[7];
      const isOffensive = classLabel === 0 || classLabel === 1;
      
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
      if (ngram.length >= 4) {
        ngrams.push(ngram);
      }
    }
  }
  
  return ngrams;
}

/**
 * Preprocess benign set: compute toTarget once, build inverted index
 */
function preprocessBenign(texts: string[]): { rows: PreprocessedRow[]; index: Map<string, Set<number>> } {
  const rows: PreprocessedRow[] = [];
  const index = new Map<string, Set<number>>();
  
  for (let i = 0; i < texts.length; i++) {
    const target = toTarget(texts[i]);
    rows.push({ id: i, target });
    
    // Index all words
    const words = target.spaced.split(/\s+/).filter(w => w.length > 0);
    for (const word of words) {
      if (!index.has(word)) {
        index.set(word, new Set());
      }
      index.get(word)!.add(i);
    }
  }
  
  return { rows, index };
}

/**
 * Fast containment check using inverted index
 */
function fastContains(
  candidate: { phrase: string; compiled: ReturnType<typeof compileWord> },
  preprocessed: { rows: PreprocessedRow[]; index: Map<string, Set<number>> }
): boolean {
  // Find rarest word in candidate phrase
  const candidateWords = candidate.phrase.split(/\s+/).filter(w => w.length > 0);
  
  let rarestWord = candidateWords[0];
  let rarestCount = preprocessed.index.get(rarestWord)?.size ?? Infinity;
  
  for (const word of candidateWords) {
    const count = preprocessed.index.get(word)?.size ?? 0;
    if (count < rarestCount) {
      rarestWord = word;
      rarestCount = count;
    }
  }
  
  // If rarest word not in index, phrase doesn't appear anywhere
  const rowIds = preprocessed.index.get(rarestWord);
  if (!rowIds || rowIds.size === 0) {
    return false;
  }
  
  // Check only rows containing rarest word
  for (const rowId of rowIds) {
    const row = preprocessed.rows[rowId];
    if (containsTerm(row.target, candidate.compiled)) {
      return true;
    }
  }
  
  return false;
}

function mineCandidatesFromBlockWords(): Candidate[] {
  console.log(`\nMining from Block_Words Part1 (dup is identical, using Part1 only)`);
  
  const rows = readBlockWords(BLOCK_WORDS_PART1);
  const offensive = rows.filter(r => r.isOffensive);
  const nonOffensive = rows.filter(r => !r.isOffensive);
  
  console.log(`  Offensive: ${offensive.length}, Non-offensive: ${nonOffensive.length}`);
  
  const phraseCounts = new Map<string, number>();
  const phraseInNegative = new Set<string>();
  
  for (const row of offensive) {
    const ngrams = extractNgrams(row.text, 2, 4);
    for (const ngram of ngrams) {
      phraseCounts.set(ngram, (phraseCounts.get(ngram) || 0) + 1);
    }
  }
  
  for (const row of nonOffensive) {
    const ngrams = extractNgrams(row.text, 2, 4);
    for (const ngram of ngrams) {
      phraseInNegative.add(ngram);
    }
  }
  
  const candidates: Candidate[] = [];
  for (const [phrase, count] of phraseCounts.entries()) {
    if (count >= 5 && !phraseInNegative.has(phrase)) {
      candidates.push({ phrase, source: 'BlockWords_Part1', support: count });
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
  console.log(`\n=== STEP 2: Gate Against TRAIN Benign Sets (Non-Circular, Optimized) ===`);
  console.log(`Input candidates: ${candidates.length}`);
  
  // Load GATE sets
  const tagalogTrainBenign = readCsv(TAGALOG_TRAIN).filter(r => r.label === 0);
  const englishTrainRows = readEnglishCsv(ENGLISH_TRAIN);
  const englishTrainBenign = englishTrainRows.filter(r => r.clean === 1);
  const marketplace = loadBenignMessages(BENIGN_MARKETPLACE);
  const user = loadBenignMessages(BENIGN_USER);
  
  console.log(`\nGate sets (used to reject candidates):`);
  console.log(`  Tagalog TRAIN benign: ${tagalogTrainBenign.length}`);
  console.log(`  English TRAIN benign: ${englishTrainBenign.length}`);
  console.log(`  Marketplace benign: ${marketplace.length}`);
  console.log(`  User benign: ${user.length}`);
  console.log(`  (VAL and TEST splits are HELD-OUT, never used for gating)`);
  
  // Preprocess each gate set
  console.log(`\nPreprocessing gate sets (toTarget + inverted index)...`);
  const tagalogPreprocessed = preprocessBenign(tagalogTrainBenign.map(r => r.text));
  console.log(`  Tagalog TRAIN: ${tagalogPreprocessed.rows.length} rows, ${tagalogPreprocessed.index.size} unique words`);
  
  const englishPreprocessed = preprocessBenign(englishTrainBenign.map(r => r.text));
  console.log(`  English TRAIN: ${englishPreprocessed.rows.length} rows, ${englishPreprocessed.index.size} unique words`);
  
  const marketplacePreprocessed = preprocessBenign(marketplace);
  console.log(`  Marketplace: ${marketplacePreprocessed.rows.length} rows`);
  
  const userPreprocessed = preprocessBenign(user);
  console.log(`  User: ${userPreprocessed.rows.length} rows`);
  
  const passed: Candidate[] = [];
  const rejected = new Map<string, number>();
  
  console.log(`\nGating ${candidates.length} candidates...`);
  
  for (let i = 0; i < candidates.length; i++) {
    if (i % 100 === 0 && i > 0) {
      console.log(`  Progress: ${i}/${candidates.length} (${passed.length} passed, ${candidates.length - passed.length - (candidates.length - i)} rejected)`);
    }
    
    const candidate = candidates[i];
    const compiled = compileWord(candidate.phrase);
    const candidateWithCompiled = { phrase: candidate.phrase, compiled };
    
    let blocked = false;
    let blockReason = '';
    
    // Check Tagalog TRAIN
    if (fastContains(candidateWithCompiled, tagalogPreprocessed)) {
      blocked = true;
      blockReason = 'Tagalog_TRAIN_benign';
    }
    
    // Check English TRAIN
    if (!blocked && fastContains(candidateWithCompiled, englishPreprocessed)) {
      blocked = true;
      blockReason = 'English_TRAIN_benign';
    }
    
    // Check marketplace
    if (!blocked && fastContains(candidateWithCompiled, marketplacePreprocessed)) {
      blocked = true;
      blockReason = 'Marketplace_benign';
    }
    
    // Check user
    if (!blocked && fastContains(candidateWithCompiled, userPreprocessed)) {
      blocked = true;
      blockReason = 'User_benign';
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
  console.log(`\n=== STEP 3: Honest Measure on HELD-OUT Validation Splits ===`);
  console.log(`(These splits were NEVER used for gating)`);
  
  // Load HELD-OUT data
  const tagalogVal = readCsv(TAGALOG_VAL);
  const tagalogValToxic = tagalogVal.filter(r => r.label === 1);
  const tagalogValBenign = tagalogVal.filter(r => r.label === 0);
  
  const englishTestRows = readEnglishCsv(ENGLISH_TEST);
  const englishTestToxic = englishTestRows.filter(r => r.vulgar === 1 || r.hate === 1 || r.adult === 1 || r.prohibited === 1);
  const englishTestBenign = englishTestRows.filter(r => r.clean === 1);
  
  const marketplace = loadBenignMessages(BENIGN_MARKETPLACE);
  
  console.log(`\nHeld-out validation sets:`);
  console.log(`  Tagalog VAL toxic: ${tagalogValToxic.length}`);
  console.log(`  Tagalog VAL benign: ${tagalogValBenign.length}`);
  console.log(`  English TEST toxic: ${englishTestToxic.length}`);
  console.log(`  English TEST benign: ${englishTestBenign.length}`);
  console.log(`  Marketplace benign: ${marketplace.length} (not split, was used in gating)`);
  
  // Compile candidates
  const compiled = candidates.map(c => ({ ...c, compiled: compileWord(c.phrase) }));
  
  // Measure Tagalog toxic catch
  let tlToxicCaught = 0;
  for (const row of tagalogValToxic) {
    const target = toTarget(row.text);
    let caught = false;
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        caught = true;
        break;
      }
    }
    if (caught) tlToxicCaught++;
  }
  
  // Measure English toxic catch
  let enToxicCaught = 0;
  for (const row of englishTestToxic) {
    const target = toTarget(row.text);
    let caught = false;
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        caught = true;
        break;
      }
    }
    if (caught) enToxicCaught++;
  }
  
  // Measure benign blocks
  let tlBenignBlocked = 0;
  for (const row of tagalogValBenign) {
    const target = toTarget(row.text);
    let blocked = false;
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        blocked = true;
        break;
      }
    }
    if (blocked) tlBenignBlocked++;
  }
  
  let enBenignBlocked = 0;
  for (const row of englishTestBenign) {
    const target = toTarget(row.text);
    let blocked = false;
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        blocked = true;
        break;
      }
    }
    if (blocked) enBenignBlocked++;
  }
  
  // Marketplace should be 0 (was used in gating)
  let marketplaceBlocked = 0;
  for (const msg of marketplace) {
    const target = toTarget(msg);
    let blocked = false;
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        blocked = true;
        break;
      }
    }
    if (blocked) marketplaceBlocked++;
  }
  
  const tlToxicRate = (tlToxicCaught / tagalogValToxic.length) * 100;
  const enToxicRate = (enToxicCaught / englishTestToxic.length) * 100;
  const tlBenignRate = (tlBenignBlocked / tagalogValBenign.length) * 100;
  const enBenignRate = (enBenignBlocked / englishTestBenign.length) * 100;
  
  console.log(`\nMined candidates alone (curated phrases ONLY, no base terms):`);
  console.log(`  Tagalog VAL toxic caught: ${tlToxicCaught}/${tagalogValToxic.length} (${tlToxicRate.toFixed(2)}%)`);
  console.log(`  English TEST toxic caught: ${enToxicCaught}/${englishTestToxic.length} (${enToxicRate.toFixed(2)}%)`);
  console.log(`  Tagalog VAL benign blocked: ${tlBenignBlocked}/${tagalogValBenign.length} (${tlBenignRate.toFixed(4)}%)`);
  console.log(`  English TEST benign blocked: ${enBenignBlocked}/${englishTestBenign.length} (${enBenignRate.toFixed(4)}%)`);
  console.log(`  Marketplace benign blocked: ${marketplaceBlocked}/${marketplace.length} (should be 0)`);
  
  // Gate validation
  const totalBenignBlocked = tlBenignBlocked + enBenignBlocked + marketplaceBlocked;
  if (totalBenignBlocked > 0) {
    console.log(`\n⚠️  WARNING: ${totalBenignBlocked} benign false positives detected on HELD-OUT sets!`);
    console.log(`  These candidates should NOT have passed the gate.`);
  } else {
    console.log(`\n✅ PASS: 0 benign false positives on HELD-OUT sets (gate worked correctly)`);
  }
}

function main() {
  console.log('=== Mine Chat Candidate Phrases - Optimized Non-Circular ===');
  console.log('Dataset inventory complete (see dataset-inventory.md)');
  console.log('Label audit: English ~80% unlabeled, only clean=1 rows used');
  console.log('');
  console.log('STRICT SPLITS:');
  console.log('  GATE sets: Tagalog TRAIN benign, English TRAIN benign (labeled only), marketplace, user, negative rows');
  console.log('  HELD-OUT sets: Tagalog VAL benign/toxic, English TEST benign/toxic (NEVER used for gating)');
  console.log('');
  console.log('OPTIMIZATIONS:');
  console.log('  1. Precompute toTarget() once per benign row');
  console.log('  2. Build inverted index: word -> row IDs');
  console.log('  3. Look up by rarest word, confirm with containsTerm');
  
  // STEP 1: Mine candidates
  console.log('\n=== STEP 1: Mine Candidates ===');
  
  const allCandidates: Candidate[] = [];
  
  if (fs.existsSync(BLOCK_WORDS_PART1)) {
    allCandidates.push(...mineCandidatesFromBlockWords());
  }
  
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
  
  const sorted = passedCandidates.sort((a, b) => b.support - a.support);
  const top = sorted.slice(0, 300);
  
  const outputPath = path.resolve(__dirname, 'data', 'chat_curated_candidates.txt');
  const lines = [
    '# Mined Chat Candidate Phrases',
    '# Generated by scripts/mine_chat_candidates_optimized.ts (non-circular, optimized)',
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

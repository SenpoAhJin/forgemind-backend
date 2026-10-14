/**
 * Mine Chat Candidates with Honest Split Discipline
 * 
 * MINE/DEV/HELD-OUT SPLITS (fixed seed 42, stratified):
 * - Tagalog train -> 80% MINE (5,130 benign + 3,758 toxic) / 20% DEV (1,283 benign + 939 toxic)
 * - English train -> 80% MINE (300,871 benign + 18,565 toxic) / 20% DEV (75,218 benign + 4,641 toxic)
 * - Block_Words -> 80% MINE / 20% DEV (offensive vs neither split)
 * - Tagalog VAL, English TEST: HELD-OUT (read ONCE at end for final numbers)
 * 
 * THRESHOLD TUNING: Try support >= 5, 10, 20, 50 per source.
 * Pick LOWEST giving 0 DEV benign blocks -> maximize DEV toxic caught.
 * 
 * GATE: ALL MINE benign (Tagalog + English), marketplace 210, user 0, negatives.
 * 
 * NO PHRASE TEXT (counts only).
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileWord, containsTerm, toTarget, MatchTarget } from '../src/moderation/normalize';
import { parseCsv } from './lib/csv';
import {
  TAGALOG_TRAIN,
  ENGLISH_TRAIN,
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
  clean: number;
  vulgar: number;
  hate: number;
  adult: number;
  prohibited: number;
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

const SEED = 42;

function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function stratifiedSplit<T extends { label?: number; clean?: number }>(
  data: T[],
  trainRatio: number,
  seed: number
): { train: T[]; test: T[] } {
  const rng = seededRandom(seed);
  
  // Group by label
  const groups = new Map<number, T[]>();
  for (const item of data) {
    const label = item.label !== undefined ? item.label : (item.clean === 1 ? 0 : 1);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }
  
  const train: T[] = [];
  const test: T[] = [];
  
  for (const [label, items] of groups.entries()) {
    const shuffled = [...items].sort(() => rng() - 0.5);
    const splitIdx = Math.floor(shuffled.length * trainRatio);
    
    // Avoid spread on large arrays (stack overflow)
    for (let i = 0; i < splitIdx; i++) {
      train.push(shuffled[i]);
    }
    for (let i = splitIdx; i < shuffled.length; i++) {
      test.push(shuffled[i]);
    }
  }
  
  return { train, test };
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
    const clean = row.clean === '1' ? 1 : 0;
    const vulgar = row.vulgar === '1' ? 1 : 0;
    const hate = row.hate === '1' ? 1 : 0;
    const adult = row.adult === '1' ? 1 : 0;
    const prohibited = row.prohibited === '1' ? 1 : 0;
    
    results.push({ id: row.id, text: row.text, clean, vulgar, hate, adult, prohibited });
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

function readBlockWords(file: string): Array<{ text: string; isOffensive: boolean }> {
  if (!fs.existsSync(file)) return [];
  
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCsv(content, false); // No header
  const results: Array<{ text: string; isOffensive: boolean }> = [];
  
  for (const row of rows) {
    const cols = Object.values(row);
    if (cols.length >= 7) {
      const classLabel = parseInt(cols[5], 10);
      const tweet = cols[6];
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

function preprocessBenign(texts: string[]): { rows: PreprocessedRow[]; index: Map<string, Set<number>> } {
  const rows: PreprocessedRow[] = [];
  const index = new Map<string, Set<number>>();
  
  for (let i = 0; i < texts.length; i++) {
    const target = toTarget(texts[i]);
    rows.push({ id: i, target });
    
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

function fastContains(
  candidate: { phrase: string; compiled: ReturnType<typeof compileWord> },
  preprocessed: { rows: PreprocessedRow[]; index: Map<string, Set<number>> }
): boolean {
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
  
  const rowIds = preprocessed.index.get(rarestWord);
  if (!rowIds || rowIds.size === 0) {
    return false;
  }
  
  for (const rowId of rowIds) {
    const row = preprocessed.rows[rowId];
    if (containsTerm(row.target, candidate.compiled)) {
      return true;
    }
  }
  
  return false;
}

function mineCandidatesFromSource(
  toxicTexts: string[],
  negativeTexts: string[],
  sourceName: string,
  minSupport: number
): Candidate[] {
  const phraseCounts = new Map<string, number>();
  const phraseInNegative = new Set<string>();
  
  for (const text of toxicTexts) {
    const ngrams = extractNgrams(text, 2, 4);
    for (const ngram of ngrams) {
      phraseCounts.set(ngram, (phraseCounts.get(ngram) || 0) + 1);
    }
  }
  
  for (const text of negativeTexts) {
    const ngrams = extractNgrams(text, 2, 4);
    for (const ngram of ngrams) {
      phraseInNegative.add(ngram);
    }
  }
  
  const candidates: Candidate[] = [];
  for (const [phrase, count] of phraseCounts.entries()) {
    if (count >= minSupport && !phraseInNegative.has(phrase)) {
      candidates.push({ phrase, source: sourceName, support: count });
    }
  }
  
  return candidates;
}

function gateAndMeasure(
  candidates: Candidate[],
  gateBenign: { rows: PreprocessedRow[]; index: Map<string, Set<number>> },
  devBenign: string[],
  devToxic: string[]
): {
  passed: Candidate[];
  rejected: number;
  devToxicCaught: number;
  devBenignBlocked: number;
} {
  const passed: Candidate[] = [];
  let rejected = 0;
  
  for (const candidate of candidates) {
    const compiled = compileWord(candidate.phrase);
    const candidateWithCompiled = { phrase: candidate.phrase, compiled };
    
    if (fastContains(candidateWithCompiled, gateBenign)) {
      rejected++;
    } else {
      passed.push(candidate);
    }
  }
  
  // Measure on DEV
  const compiled = passed.map(c => ({ ...c, compiled: compileWord(c.phrase) }));
  
  let devToxicCaught = 0;
  for (const text of devToxic) {
    const target = toTarget(text);
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        devToxicCaught++;
        break;
      }
    }
  }
  
  let devBenignBlocked = 0;
  for (const text of devBenign) {
    const target = toTarget(text);
    for (const c of compiled) {
      if (containsTerm(target, c.compiled)) {
        devBenignBlocked++;
        break;
      }
    }
  }
  
  return { passed, rejected, devToxicCaught, devBenignBlocked };
}

function main() {
  console.log('=== Mine Chat Candidates with Split Discipline (MINE/DEV/HELD-OUT) ===');
  console.log('Fixed seed: 42, stratified splits\n');
  
  // Load and split datasets
  console.log('Loading and splitting datasets...');
  
  const tagalogAll = readCsv(TAGALOG_TRAIN);
  const tagalogSplit = stratifiedSplit(tagalogAll, 0.8, SEED);
  const tagalogMineBenign = tagalogSplit.train.filter(r => r.label === 0);
  const tagalogMineToxic = tagalogSplit.train.filter(r => r.label === 1);
  const tagalogDevBenign = tagalogSplit.test.filter(r => r.label === 0);
  const tagalogDevToxic = tagalogSplit.test.filter(r => r.label === 1);
  
  console.log(`Tagalog: MINE ${tagalogSplit.train.length} (${tagalogMineBenign.length} benign, ${tagalogMineToxic.length} toxic), DEV ${tagalogSplit.test.length} (${tagalogDevBenign.length} benign, ${tagalogDevToxic.length} toxic)`);
  
  const englishAll = readEnglishCsv(ENGLISH_TRAIN);
  const englishSplit = stratifiedSplit(englishAll, 0.8, SEED);
  const englishMineBenign = englishSplit.train.filter(r => r.clean === 1);
  const englishMineToxic = englishSplit.train.filter(r => r.vulgar === 1 || r.hate === 1 || r.adult === 1 || r.prohibited === 1);
  const englishDevBenign = englishSplit.test.filter(r => r.clean === 1);
  const englishDevToxic = englishSplit.test.filter(r => r.vulgar === 1 || r.hate === 1 || r.adult === 1 || r.prohibited === 1);
  
  console.log(`English: MINE ${englishSplit.train.length} (${englishMineBenign.length} benign, ${englishMineToxic.length} toxic), DEV ${englishSplit.test.length} (${englishDevBenign.length} benign, ${englishDevToxic.length} toxic)`);
  
  const blockWordsAll = readBlockWords(BLOCK_WORDS_PART1);
  const blockWordsSplit = stratifiedSplit(
    blockWordsAll.map(r => ({ ...r, label: r.isOffensive ? 1 : 0 })),
    0.8,
    SEED
  );
  const blockWordsMineOffensive = blockWordsSplit.train.filter(r => r.label === 1);
  const blockWordsMineNegative = blockWordsSplit.train.filter(r => r.label === 0);
  const blockWordsDevOffensive = blockWordsSplit.test.filter(r => r.label === 1);
  const blockWordsDevNegative = blockWordsSplit.test.filter(r => r.label === 0);
  
  console.log(`Block_Words: MINE ${blockWordsSplit.train.length} (${blockWordsMineOffensive.length} offensive, ${blockWordsMineNegative.length} neither), DEV ${blockWordsSplit.test.length} (${blockWordsDevOffensive.length} offensive, ${blockWordsDevNegative.length} neither)`);
  
  const marketplace = loadBenignMessages(BENIGN_MARKETPLACE);
  const user = loadBenignMessages(BENIGN_USER);
  console.log(`Marketplace: ${marketplace.length}, User: ${user.length}\n`);
  
  // Preprocess GATE benign (ALL MINE benign + marketplace + user)
  console.log('Preprocessing GATE benign set (inverted index)...');
  const allMineBenign = [
    ...tagalogMineBenign.map(r => r.text),
    ...englishMineBenign.map(r => r.text),
    ...marketplace,
    ...user
  ];
  const gateBenign = preprocessBenign(allMineBenign);
  console.log(`GATE benign: ${gateBenign.rows.length} rows, ${gateBenign.index.size} unique words\n`);
  
  // Threshold tuning per source
  const thresholds = [5, 10, 20, 50];
  const results: Array<{
    source: string;
    threshold: number;
    mined: number;
    passedGate: number;
    rejected: number;
    devToxicCaught: number;
    devToxicTotal: number;
    devBenignBlocked: number;
    devBenignTotal: number;
    candidates: Candidate[];
  }> = [];
  
  // Tagalog
  console.log('=== Tagalog Threshold Tuning ===');
  let tagalogBestThreshold = -1;
  let tagalogBestCandidates: Candidate[] = [];
  
  for (const threshold of thresholds) {
    const mined = mineCandidatesFromSource(
      tagalogMineToxic.map(r => r.text),
      tagalogMineBenign.map(r => r.text),
      'Tagalog',
      threshold
    );
    
    const measured = gateAndMeasure(
      mined,
      gateBenign,
      tagalogDevBenign.map(r => r.text),
      tagalogDevToxic.map(r => r.text)
    );
    
    console.log(`  Threshold ${threshold}: mined ${mined.length}, passed gate ${measured.passed.length}, rejected ${measured.rejected}, DEV toxic ${measured.devToxicCaught}/${tagalogDevToxic.length}, DEV benign ${measured.devBenignBlocked}/${tagalogDevBenign.length}`);
    
    if (measured.devBenignBlocked === 0) {
      if (tagalogBestThreshold === -1 || threshold < tagalogBestThreshold) {
        tagalogBestThreshold = threshold;
        tagalogBestCandidates = measured.passed;
      }
    }
  }
  
  if (tagalogBestThreshold !== -1) {
    console.log(`  CHOSEN: threshold ${tagalogBestThreshold} (lowest with 0 DEV benign blocks)\n`);
    const mined = mineCandidatesFromSource(
      tagalogMineToxic.map(r => r.text),
      tagalogMineBenign.map(r => r.text),
      'Tagalog',
      tagalogBestThreshold
    );
    const measured = gateAndMeasure(
      mined,
      gateBenign,
      tagalogDevBenign.map(r => r.text),
      tagalogDevToxic.map(r => r.text)
    );
    results.push({
      source: 'Tagalog',
      threshold: tagalogBestThreshold,
      mined: mined.length,
      passedGate: measured.passed.length,
      rejected: measured.rejected,
      devToxicCaught: measured.devToxicCaught,
      devToxicTotal: tagalogDevToxic.length,
      devBenignBlocked: measured.devBenignBlocked,
      devBenignTotal: tagalogDevBenign.length,
      candidates: measured.passed
    });
  } else {
    console.log(`  FAILED: no threshold gives 0 DEV benign blocks\n`);
  }
  
  // English
  console.log('=== English Threshold Tuning ===');
  let englishBestThreshold = -1;
  let englishBestCandidates: Candidate[] = [];
  
  for (const threshold of thresholds) {
    const mined = mineCandidatesFromSource(
      englishMineToxic.map(r => r.text),
      englishMineBenign.map(r => r.text),
      'English',
      threshold
    );
    
    const measured = gateAndMeasure(
      mined,
      gateBenign,
      englishDevBenign.map(r => r.text),
      englishDevToxic.map(r => r.text)
    );
    
    console.log(`  Threshold ${threshold}: mined ${mined.length}, passed gate ${measured.passed.length}, rejected ${measured.rejected}, DEV toxic ${measured.devToxicCaught}/${englishDevToxic.length}, DEV benign ${measured.devBenignBlocked}/${englishDevBenign.length}`);
    
    if (measured.devBenignBlocked === 0) {
      if (englishBestThreshold === -1 || threshold < englishBestThreshold) {
        englishBestThreshold = threshold;
        englishBestCandidates = measured.passed;
      }
    }
  }
  
  if (englishBestThreshold !== -1) {
    console.log(`  CHOSEN: threshold ${englishBestThreshold} (lowest with 0 DEV benign blocks)\n`);
    const mined = mineCandidatesFromSource(
      englishMineToxic.map(r => r.text),
      englishMineBenign.map(r => r.text),
      'English',
      englishBestThreshold
    );
    const measured = gateAndMeasure(
      mined,
      gateBenign,
      englishDevBenign.map(r => r.text),
      englishDevToxic.map(r => r.text)
    );
    results.push({
      source: 'English',
      threshold: englishBestThreshold,
      mined: mined.length,
      passedGate: measured.passed.length,
      rejected: measured.rejected,
      devToxicCaught: measured.devToxicCaught,
      devToxicTotal: englishDevToxic.length,
      devBenignBlocked: measured.devBenignBlocked,
      devBenignTotal: englishDevBenign.length,
      candidates: measured.passed
    });
  } else {
    console.log(`  FAILED: no threshold gives 0 DEV benign blocks\n`);
  }
  
  // Block_Words
  console.log('=== Block_Words Threshold Tuning ===');
  let blockWordsBestThreshold = -1;
  let blockWordsBestCandidates: Candidate[] = [];
  
  for (const threshold of thresholds) {
    const mined = mineCandidatesFromSource(
      blockWordsMineOffensive.map(r => r.text),
      blockWordsMineNegative.map(r => r.text),
      'BlockWords',
      threshold
    );
    
    const measured = gateAndMeasure(
      mined,
      gateBenign,
      [...tagalogDevBenign.map(r => r.text), ...englishDevBenign.map(r => r.text)],
      blockWordsDevOffensive.map(r => r.text)
    );
    
    console.log(`  Threshold ${threshold}: mined ${mined.length}, passed gate ${measured.passed.length}, rejected ${measured.rejected}, DEV toxic ${measured.devToxicCaught}/${blockWordsDevOffensive.length}, DEV benign ${measured.devBenignBlocked}/${tagalogDevBenign.length + englishDevBenign.length}`);
    
    if (measured.devBenignBlocked === 0) {
      if (blockWordsBestThreshold === -1 || threshold < blockWordsBestThreshold) {
        blockWordsBestThreshold = threshold;
        blockWordsBestCandidates = measured.passed;
      }
    }
  }
  
  if (blockWordsBestThreshold !== -1) {
    console.log(`  CHOSEN: threshold ${blockWordsBestThreshold} (lowest with 0 DEV benign blocks)\n`);
    const mined = mineCandidatesFromSource(
      blockWordsMineOffensive.map(r => r.text),
      blockWordsMineNegative.map(r => r.text),
      'BlockWords',
      blockWordsBestThreshold
    );
    const measured = gateAndMeasure(
      mined,
      gateBenign,
      [...tagalogDevBenign.map(r => r.text), ...englishDevBenign.map(r => r.text)],
      blockWordsDevOffensive.map(r => r.text)
    );
    results.push({
      source: 'BlockWords',
      threshold: blockWordsBestThreshold,
      mined: mined.length,
      passedGate: measured.passed.length,
      rejected: measured.rejected,
      devToxicCaught: measured.devToxicCaught,
      devToxicTotal: blockWordsDevOffensive.length,
      devBenignBlocked: measured.devBenignBlocked,
      devBenignTotal: tagalogDevBenign.length + englishDevBenign.length,
      candidates: measured.passed
    });
  } else {
    console.log(`  FAILED: no threshold gives 0 DEV benign blocks\n`);
  }
  
  // Summary table
  console.log('=== SUMMARY TABLE ===');
  console.log('source | mined | passed_gate | rejected | threshold | DEV_toxic_caught | DEV_benign_blocked');
  console.log('-------|-------|-------------|----------|-----------|------------------|-------------------');
  
  for (const r of results) {
    console.log(`${r.source} | ${r.mined} | ${r.passedGate} | ${r.rejected} | ${r.threshold} | ${r.devToxicCaught}/${r.devToxicTotal} | ${r.devBenignBlocked}/${r.devBenignTotal}`);
  }
  
  if (results.length === 0) {
    console.log('(No sources passed DEV validation)');
  }
  
  // Save results for STEP 3
  const outputPath = path.resolve(__dirname, 'data', 'mining_results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSaved results to: ${outputPath}`);
  console.log('Ready for STEP 3 (held-out measurement)');
}

main();

/**
 * Mine Chat Candidate Phrases - Non-Circular Version
 * 
 * STRICT SPLITS:
 * - GATE sets (used to reject candidates): Tagalog TRAIN benign, English TRAIN benign, marketplace benign, user benign, negative rows
 * - HELD-OUT sets (NEVER used for gating, only for measuring): Tagalog VAL benign/toxic, English TEST benign/toxic
 * 
 * STEP 1: Extract candidates from Block_Words (Part1 only, dup is identical) and Tagalog toxic
 * STEP 2: Gate against TRAIN benign sets ONLY (0 hits required)
 * STEP 3: Measure on HELD-OUT validation splits (never seen during gating)
 * STEP 4: Output ranked candidates for user review
 * 
 * NO TEXT PRINTED (counts/ids only).
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';
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
  field: string;
  source: string;
  clean: number;
  vulgar: number;
  hate: number;
  adult: number;
  prohibited: number;
  unrelated: number;
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

function readEnglishCsv(file: string): EnglishRow[] {
  if (!fs.existsSync(file)) return [];
  
  const content = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const lines = content.split('\n').filter(l => l.trim());
  const rows: EnglishRow[] = [];
  
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 10) {
      rows.push({
        id: parts[0],
        text: parts[1],
        field: parts[2],
        source: parts[3],
        clean: parseInt(parts[4], 10),
        vulgar: parseInt(parts[5], 10),
        hate: parseInt(parts[6], 10),
        adult: parseInt(parts[7], 10),
        prohibited: parseInt(parts[8], 10),
        unrelated: parseInt(parts[9], 10)
      });
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

function mineCandidatesFromBlockWords(): Candidate[] {
  console.log(`\nMining from Block_Words Part1 (dup is identical, using Part1 only)`);
  
  const rows = readBlockWords(BLOCK_WORDS_PART1);
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
  console.log(`\n=== STEP 2: Gate Against TRAIN Benign Sets (Non-Circular) ===`);
  console.log(`Input candidates: ${candidates.length}`);
  
  // Load GATE sets (Tagalog TRAIN benign, English TRAIN benign, marketplace, user)
  // NEVER load VAL or TEST - those are HELD-OUT for measurement
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
  
  const passed: Candidate[] = [];
  const rejected = new Map<string, number>(); // reason -> count
  
  for (const candidate of candidates) {
    const compiled = compileWord(candidate.phrase);
    let blocked = false;
    let blockReason = '';
    
    // Check Tagalog TRAIN benign
    for (const row of tagalogTrainBenign) {
      if (containsTerm(toTarget(row.text), compiled)) {
        blocked = true;
        blockReason = 'Tagalog_TRAIN_benign';
        break;
      }
    }
    
    if (!blocked) {
      // Check English TRAIN benign
      for (const row of englishTrainBenign) {
        if (containsTerm(toTarget(row.text), compiled)) {
          blocked = true;
          blockReason = 'English_TRAIN_benign';
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
  console.log(`\n=== STEP 3: Honest Measure on HELD-OUT Validation Splits ===`);
  console.log(`(These splits were NEVER used for gating)`);
  
  // Load HELD-OUT data (VAL and TEST)
  const tagalogVal = readCsv(TAGALOG_VAL);
  const tagalogValToxic = tagalogVal.filter(r => r.label === 1);
  const tagalogValBenign = tagalogVal.filter(r => r.label === 0);
  
  const englishTestRows = readEnglishCsv(ENGLISH_TEST);
  const englishTestToxic = englishTestRows.filter(r => r.vulgar === 1 || r.hate === 1 || r.adult === 1 || r.prohibited === 1);
  const englishTestBenign = englishTestRows.filter(r => r.clean === 1);
  
  const marketplace = loadBenignMessages(BENIGN_MARKETPLACE);
  const user = loadBenignMessages(BENIGN_USER);
  
  console.log(`\nHeld-out validation sets:`);
  console.log(`  Tagalog VAL toxic: ${tagalogValToxic.length}`);
  console.log(`  Tagalog VAL benign: ${tagalogValBenign.length}`);
  console.log(`  English TEST toxic: ${englishTestToxic.length}`);
  console.log(`  English TEST benign: ${englishTestBenign.length}`);
  console.log(`  Marketplace benign: ${marketplace.length} (not split, used in gating)`);
  console.log(`  User benign: ${user.length} (empty, used in gating)`);
  
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
  
  // Marketplace/user were already used in gating, so 0 expected
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
    console.log(`\n⚠️  WARNING: ${totalBenignBlocked} benign false positives detected!`);
    console.log(`  These candidates should NOT have passed the gate.`);
  } else {
    console.log(`\n✅ PASS: 0 benign false positives on HELD-OUT sets (gate worked correctly)`);
  }
}

function main() {
  console.log('=== Mine Chat Candidate Phrases - Non-Circular ===');
  console.log('Dataset inventory complete (see dataset-inventory.md)');
  console.log('  - Explicit_Datasets: IMAGES (JPG) - SKIPPED');
  console.log('  - Block_Words Part1: TEXT (offensive tweets) - Part1 only, dup is identical');
  console.log('  - Tagalog toxic: TEXT (chat harassment)');
  console.log('  - English: processed/ folder with train/test/val splits');
  console.log('');
  console.log('STRICT SPLITS:');
  console.log('  GATE sets: Tagalog TRAIN benign, English TRAIN benign, marketplace, user, negative rows');
  console.log('  HELD-OUT sets: Tagalog VAL benign/toxic, English TEST benign/toxic (NEVER used for gating)');
  
  // STEP 1: Mine candidates
  console.log('\n=== STEP 1: Mine Candidates ===');
  
  const allCandidates: Candidate[] = [];
  
  // From Block_Words (Part1 only, dup is identical)
  if (fs.existsSync(BLOCK_WORDS_PART1)) {
    allCandidates.push(...mineCandidatesFromBlockWords());
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
    '# Generated by scripts/mine_chat_candidates.ts (non-circular version)',
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

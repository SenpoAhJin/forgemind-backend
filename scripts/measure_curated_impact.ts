/**
 * Measure impact of curated terms on toxic/benign rates
 * Also test obfuscations
 */

import * as fs from 'fs';
import * as path from 'path';
import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';
import { CHAT_BLOCKLIST, CURATED_TERMS, FULL_BLOCKLIST } from '../src/marketplace/chatBlocklist';

const DATASETS_DIR = path.resolve(__dirname, '..', '..', 'forgemind-ai', 'marketplace_datasets');

function readCsv(filepath: string): Array<{ text: string; label: number }> {
  if (!fs.existsSync(filepath)) return [];
  const content = fs.readFileSync(filepath, 'utf8');
  const lines = content.split('\n').slice(1);
  return lines
    .map(line => {
      const match = line.match(/^([^,]*),([^,]*),"([^"]*)"/);
      if (!match) return null;
      return { text: match[3], label: parseInt(match[2]) };
    })
    .filter(row => row !== null) as Array<{ text: string; label: number }>;
}

function loadLines(filename: string): string[] {
  const file = path.join(__dirname, filename);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

// Load datasets
const tagalogVal = readCsv(path.join(DATASETS_DIR, 'Tagalog_Datasets', 'val.csv'));
const englishTest = readCsv(path.join(DATASETS_DIR, 'English_Datasets', 'test.csv'));
const marketplaceBenign = loadLines('data/benign_marketplace.txt');
const userBenign = loadLines('data/benign_user.txt');

console.log('\n=== MEASUREMENT: CURATED TERMS IMPACT ===\n');
console.log(`Existing terms: ${CHAT_BLOCKLIST.length}`);
console.log(`Curated terms: ${CURATED_TERMS.length}`);
console.log(`Total terms: ${FULL_BLOCKLIST.length}\n`);

// Compile
const compiledOriginal = CHAT_BLOCKLIST.map(t => compileWord(t));
const compiledFull = FULL_BLOCKLIST.map(t => compileWord(t));

function testSet(
  name: string,
  messages: Array<{ text: string; label: number }>,
  compiledTerms: ReturnType<typeof compileWord>[]
): { toxicCaught: number; toxicTotal: number; benignBlocked: number; benignTotal: number } {
  const toxic = messages.filter(m => m.label === 1);
  const benign = messages.filter(m => m.label === 0);
  
  const toxicCaught = toxic.filter(m => compiledTerms.some(term => containsTerm(toTarget(m.text), term))).length;
  const benignBlocked = benign.filter(m => compiledTerms.some(term => containsTerm(toTarget(m.text), term))).length;
  
  return {
    toxicCaught,
    toxicTotal: toxic.length,
    benignBlocked,
    benignTotal: benign.length
  };
}

function testBenignOnly(
  name: string,
  messages: string[],
  compiledTerms: ReturnType<typeof compileWord>[]
): number {
  return messages.filter(m => compiledTerms.some(term => containsTerm(toTarget(m), term))).length;
}

// Tagalog val
if (tagalogVal.length > 0) {
  const before = testSet('Tagalog val', tagalogVal, compiledOriginal);
  const after = testSet('Tagalog val', tagalogVal, compiledFull);
  
  console.log('TAGALOG VAL (2778 messages):');
  console.log(`  BEFORE: Toxic ${before.toxicCaught}/${before.toxicTotal} (${(100*before.toxicCaught/before.toxicTotal).toFixed(1)}%), Benign ${before.benignBlocked}/${before.benignTotal} (${(100*before.benignBlocked/before.benignTotal).toFixed(2)}%)`);
  console.log(`  AFTER:  Toxic ${after.toxicCaught}/${after.toxicTotal} (${(100*after.toxicCaught/after.toxicTotal).toFixed(1)}%), Benign ${after.benignBlocked}/${after.benignTotal} (${(100*after.benignBlocked/after.benignTotal).toFixed(2)}%)`);
  console.log(`  CHANGE: Toxic +${after.toxicCaught-before.toxicCaught}, Benign +${after.benignBlocked-before.benignBlocked}\n`);
} else {
  console.log('TAGALOG VAL: Dataset not found\n');
}

// English held-out
if (englishTest.length > 0) {
  const before = testSet('English test', englishTest, compiledOriginal);
  const after = testSet('English test', englishTest, compiledFull);
  
  console.log('ENGLISH HELD-OUT (~65K messages):');
  console.log(`  BEFORE: Toxic ${before.toxicCaught}/${before.toxicTotal} (${(100*before.toxicCaught/before.toxicTotal).toFixed(1)}%), Benign ${before.benignBlocked}/${before.benignTotal} (${(100*before.benignBlocked/before.benignTotal).toFixed(2)}%)`);
  console.log(`  AFTER:  Toxic ${after.toxicCaught}/${after.toxicTotal} (${(100*after.toxicCaught/after.toxicTotal).toFixed(1)}%), Benign ${after.benignBlocked}/${after.benignTotal} (${(100*after.benignBlocked/after.benignTotal).toFixed(2)}%)`);
  console.log(`  CHANGE: Toxic +${after.toxicCaught-before.toxicCaught}, Benign +${after.benignBlocked-before.benignBlocked}\n`);
} else {
  console.log('ENGLISH HELD-OUT: Dataset not found\n');
}

// Marketplace benign
const marketplaceBefore = testBenignOnly('Marketplace', marketplaceBenign, compiledOriginal);
const marketplaceAfter = testBenignOnly('Marketplace', marketplaceBenign, compiledFull);
console.log(`MARKETPLACE BENIGN (210 messages):`);
console.log(`  BEFORE: ${marketplaceBefore}/210 (${(100*marketplaceBefore/210).toFixed(2)}%)`);
console.log(`  AFTER:  ${marketplaceAfter}/210 (${(100*marketplaceAfter/210).toFixed(2)}%)`);
console.log(`  CHANGE: +${marketplaceAfter-marketplaceBefore}\n`);

// User benign
if (userBenign.length > 0) {
  const userBefore = testBenignOnly('User', userBenign, compiledOriginal);
  const userAfter = testBenignOnly('User', userBenign, compiledFull);
  console.log(`USER BENIGN (${userBenign.length} messages):`);
  console.log(`  BEFORE: ${userBefore}/${userBenign.length}`);
  console.log(`  AFTER:  ${userAfter}/${userBenign.length}`);
  console.log(`  CHANGE: +${userAfter-userBefore}\n`);
} else {
  console.log(`USER BENIGN: No messages\n`);
}

// Obfuscation tests
if (CURATED_TERMS.length > 0) {
  console.log('=== OBFUSCATION TESTS ===\n');
  
  for (let i = 0; i < CURATED_TERMS.length; i++) {
    const phrase = CURATED_TERMS[i];
    const compiled = compileWord(phrase);
    
    // Generate 3 obfuscations
    const obfuscations: string[] = [];
    
    // 1. Spaced letters (only on phrases with no spaces)
    if (!phrase.includes(' ')) {
      obfuscations.push(phrase.split('').join(' '));
    } else {
      // Add spaces within each word
      obfuscations.push(phrase.split(' ').map(w => w.split('').join(' ')).join(' '));
    }
    
    // 2. Repeated letters
    obfuscations.push(phrase.replace(/(.)/g, '$1$1'));
    
    // 3. Number swaps (a->4, e->3, i->1, o->0)
    obfuscations.push(phrase.replace(/a/g, '4').replace(/e/g, '3').replace(/i/g, '1').replace(/o/g, '0'));
    
    const blocked = obfuscations.filter(obf => containsTerm(toTarget(obf), compiled)).length;
    
    console.log(`Phrase ${i+1}: ${blocked}/${obfuscations.length} obfuscations blocked`);
  }
}

console.log('\n');
process.exit(0);

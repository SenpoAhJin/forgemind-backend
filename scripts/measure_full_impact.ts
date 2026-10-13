/**
 * Full Before/After Measurement - Curated Terms Impact
 * 
 * Measures chat moderation performance with and without curated terms:
 * - Baseline: 25 base terms (CHAT_BLOCKLIST)
 * - With curated: 25 base + curated kept terms (FULL_BLOCKLIST)
 * 
 * Datasets:
 * - Tagalog val (never used for selection): toxic catch rate, benign false blocks
 * - English held-out test set: toxic catch rate, benign false blocks
 * - Marketplace benign: 0% false blocks required
 * - User benign: 0% false blocks required
 */

import fs from 'fs';
import path from 'path';
import { compileWord, containsTerm, toTarget } from '../src/moderation/normalize';

const DATASETS_DIR = path.resolve(__dirname, '..', '..', 'forgemind-ai', 'marketplace_datasets');
const BENIGN_MARKETPLACE_FILE = path.resolve(__dirname, 'data', 'benign_marketplace.txt');
const BENIGN_USER_FILE = path.resolve(__dirname, 'data', 'benign_user.txt');

// Base blocklist (from chatBlocklist.ts CHAT_BLOCKLIST - exact copy)
const BASE_TERMS = [
  "fuck you",
  "motherfucker",
  "stupid bitch",
  "kill yourself",
  "kys",
  "nigger",
  "faggot",
  "cunt",
  "whore",
  "slut",
  "asshole",
  "dickhead",
  "retard",
  "putangina mo",
  "gago ka",
  "tanga ka",
  "bobo ka",
  "hayop ka",
  "bwisit ka",
  "send nudes",
  "show tits",
  "show ass",
  "suck my",
  "fuck me",
  "wanna fuck"
];

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

function loadCuratedKept(): string[] {
  const keptFile = path.resolve(__dirname, 'data', 'chat_curated_terms_kept.txt');
  if (!fs.existsSync(keptFile)) return [];
  
  const content = fs.readFileSync(keptFile, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

interface MeasurementResult {
  toxicCaught: number;
  toxicMissed: number;
  toxicTotal: number;
  toxicRate: number;
  benignBlocked: number;
  benignPassed: number;
  benignTotal: number;
  benignBlockRate: number;
}

function measureTerms(
  terms: string[],
  toxicRows: Row[],
  benignRows: Row[]
): MeasurementResult {
  const compiled = terms.map(t => compileWord(t));
  
  let toxicCaught = 0;
  let toxicMissed = 0;
  
  for (const row of toxicRows) {
    const target = toTarget(row.text);
    let blocked = false;
    
    for (const c of compiled) {
      if (containsTerm(target, c)) {
        blocked = true;
        break;
      }
    }
    
    if (blocked) toxicCaught++;
    else toxicMissed++;
  }
  
  let benignBlocked = 0;
  let benignPassed = 0;
  
  for (const row of benignRows) {
    const target = toTarget(row.text);
    let blocked = false;
    
    for (const c of compiled) {
      if (containsTerm(target, c)) {
        blocked = true;
        break;
      }
    }
    
    if (blocked) benignBlocked++;
    else benignPassed++;
  }
  
  return {
    toxicCaught,
    toxicMissed,
    toxicTotal: toxicRows.length,
    toxicRate: toxicRows.length > 0 ? (toxicCaught / toxicRows.length) * 100 : 0,
    benignBlocked,
    benignPassed,
    benignTotal: benignRows.length,
    benignBlockRate: benignRows.length > 0 ? (benignBlocked / benignRows.length) * 100 : 0,
  };
}

function measureBenignMessages(terms: string[], messages: string[]): {blocked: number; passed: number; total: number; rate: number} {
  const compiled = terms.map(t => compileWord(t));
  
  let blocked = 0;
  let passed = 0;
  
  for (const msg of messages) {
    const target = toTarget(msg);
    let isBlocked = false;
    
    for (const c of compiled) {
      if (containsTerm(target, c)) {
        isBlocked = true;
        break;
      }
    }
    
    if (isBlocked) blocked++;
    else passed++;
  }
  
  return {
    blocked,
    passed,
    total: messages.length,
    rate: messages.length > 0 ? (blocked / messages.length) * 100 : 0,
  };
}

function formatPct(rate: number): string {
  return rate.toFixed(2) + '%';
}

function main() {
  console.log('=== Full Before/After Measurement ===\n');
  
  // Load curated kept terms
  const curatedKept = loadCuratedKept();
  console.log(`Curated kept terms: ${curatedKept.length}`);
  if (curatedKept.length === 0) {
    console.log(`  (No curated terms passed validation - measuring base 25 only)\n`);
  } else {
    console.log(`  Terms: (count only, text hidden)\n`);
  }
  
  // Load datasets
  console.log('Loading datasets...');
  const tagalogVal = readCsv(path.join(DATASETS_DIR, 'Tagalog_Datasets', 'val.csv'));
  const englishFile = path.join(DATASETS_DIR, 'English_Datasets', 'test.csv');
  const englishHeldout = fs.existsSync(englishFile) ? readCsv(englishFile) : [];
  const benignMarketplace = loadBenignMessages(BENIGN_MARKETPLACE_FILE);
  const benignUser = loadBenignMessages(BENIGN_USER_FILE);
  
  const tagalogValToxic = tagalogVal.filter(r => r.label === 1);
  const tagalogValBenign = tagalogVal.filter(r => r.label === 0);
  const englishToxic = englishHeldout.filter(r => r.label === 1);
  const englishBenign = englishHeldout.filter(r => r.label === 0);
  
  console.log(`  Tagalog val: ${tagalogVal.length} (${tagalogValToxic.length} toxic, ${tagalogValBenign.length} benign)`);
  console.log(`  English held-out: ${englishHeldout.length} (${englishToxic.length} toxic, ${englishBenign.length} benign)`);
  console.log(`  Marketplace benign: ${benignMarketplace.length}`);
  console.log(`  User benign: ${benignUser.length}\n`);
  
  // Baseline measurement (26 base terms)
  console.log('=== BASELINE (26 base terms) ===\n');
  
  const baseTagalog = measureTerms(BASE_TERMS, tagalogValToxic, tagalogValBenign);
  console.log('Tagalog val:');
  console.log(`  Toxic caught: ${baseTagalog.toxicCaught}/${baseTagalog.toxicTotal} (${formatPct(baseTagalog.toxicRate)})`);
  console.log(`  Benign blocked: ${baseTagalog.benignBlocked}/${baseTagalog.benignTotal} (${formatPct(baseTagalog.benignBlockRate)})\n`);
  
  const baseEnglish = measureTerms(BASE_TERMS, englishToxic, englishBenign);
  console.log('English held-out:');
  console.log(`  Toxic caught: ${baseEnglish.toxicCaught}/${baseEnglish.toxicTotal} (${formatPct(baseEnglish.toxicRate)})`);
  console.log(`  Benign blocked: ${baseEnglish.benignBlocked}/${baseEnglish.benignTotal} (${formatPct(baseEnglish.benignBlockRate)})\n`);
  
  const baseMarketplace = measureBenignMessages(BASE_TERMS, benignMarketplace);
  console.log('Marketplace benign:');
  console.log(`  Blocked: ${baseMarketplace.blocked}/${baseMarketplace.total} (${formatPct(baseMarketplace.rate)})\n`);
  
  const baseUser = measureBenignMessages(BASE_TERMS, benignUser);
  console.log('User benign:');
  console.log(`  Blocked: ${baseUser.blocked}/${baseUser.total} (${formatPct(baseUser.rate)})\n`);
  
  // After measurement (base + curated)
  if (curatedKept.length > 0) {
    console.log(`=== WITH CURATED (26 base + ${curatedKept.length} curated = ${BASE_TERMS.length + curatedKept.length} total) ===\n`);
    
    const fullTerms = [...BASE_TERMS, ...curatedKept];
    
    const curatedTagalog = measureTerms(fullTerms, tagalogValToxic, tagalogValBenign);
    console.log('Tagalog val:');
    console.log(`  Toxic caught: ${curatedTagalog.toxicCaught}/${curatedTagalog.toxicTotal} (${formatPct(curatedTagalog.toxicRate)})`);
    console.log(`  Benign blocked: ${curatedTagalog.benignBlocked}/${curatedTagalog.benignTotal} (${formatPct(curatedTagalog.benignBlockRate)})`);
    console.log(`  Change: toxic +${curatedTagalog.toxicCaught - baseTagalog.toxicCaught}, benign +${curatedTagalog.benignBlocked - baseTagalog.benignBlocked}\n`);
    
    const curatedEnglish = measureTerms(fullTerms, englishToxic, englishBenign);
    console.log('English held-out:');
    console.log(`  Toxic caught: ${curatedEnglish.toxicCaught}/${curatedEnglish.toxicTotal} (${formatPct(curatedEnglish.toxicRate)})`);
    console.log(`  Benign blocked: ${curatedEnglish.benignBlocked}/${curatedEnglish.benignTotal} (${formatPct(curatedEnglish.benignBlockRate)})`);
    console.log(`  Change: toxic +${curatedEnglish.toxicCaught - baseEnglish.toxicCaught}, benign +${curatedEnglish.benignBlocked - baseEnglish.benignBlocked}\n`);
    
    const curatedMarketplace = measureBenignMessages(fullTerms, benignMarketplace);
    console.log('Marketplace benign:');
    console.log(`  Blocked: ${curatedMarketplace.blocked}/${curatedMarketplace.total} (${formatPct(curatedMarketplace.rate)})`);
    console.log(`  Change: +${curatedMarketplace.blocked - baseMarketplace.blocked}\n`);
    
    const curatedUser = measureBenignMessages(fullTerms, benignUser);
    console.log('User benign:');
    console.log(`  Blocked: ${curatedUser.blocked}/${curatedUser.total} (${formatPct(curatedUser.rate)})`);
    console.log(`  Change: +${curatedUser.blocked - baseUser.blocked}\n`);
    
    // Summary
    console.log('=== IMPACT SUMMARY ===\n');
    console.log(`Added ${curatedKept.length} curated term(s):`);
    console.log(`  Tagalog: +${curatedTagalog.toxicCaught - baseTagalog.toxicCaught} toxic caught, +${curatedTagalog.benignBlocked - baseTagalog.benignBlocked} benign blocked`);
    console.log(`  English: +${curatedEnglish.toxicCaught - baseEnglish.toxicCaught} toxic caught, +${curatedEnglish.benignBlocked - baseEnglish.benignBlocked} benign blocked`);
    console.log(`  Marketplace: +${curatedMarketplace.blocked - baseMarketplace.blocked} benign blocked`);
    console.log(`  User: +${curatedUser.blocked - baseUser.blocked} benign blocked\n`);
    
    // Validation
    const allBenignIncrease = 
      (curatedTagalog.benignBlocked - baseTagalog.benignBlocked) +
      (curatedEnglish.benignBlocked - baseEnglish.benignBlocked) +
      (curatedMarketplace.blocked - baseMarketplace.blocked) +
      (curatedUser.blocked - baseUser.blocked);
    
    if (allBenignIncrease === 0) {
      console.log('✅ PASS: No increase in benign false blocks');
    } else {
      console.log(`⚠️  WARNING: +${allBenignIncrease} benign false blocks added`);
    }
  } else {
    console.log('=== AFTER (same as baseline - no curated terms kept) ===\n');
    console.log('Measurement identical to baseline above.\n');
  }
  
  process.exit(0);
}

main();

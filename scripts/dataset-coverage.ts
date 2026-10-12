/**
 * Step 2g part 2: what the datasets actually say about language and class.
 *
 * Prints counts only. A row body, a term or a dataset record is never printed.
 * The processed CSVs are quoted RFC 4180 with embedded newlines, so they are
 * parsed as CSV rather than split on commas.
 */
import { readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AI = join(ROOT, '..', 'forgemind-ai', 'marketplace_datasets');

/** RFC 4180 parser, one record at a time, so a 95 MB file never sits in memory. */
function* csvRecords(path: string): Generator<string[]> {
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(1 << 20);
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  let hasField = false;
  let pendingCR = false;
  try {
    let bytesRead = 0;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      for (let i = 0; i < bytesRead; i++) {
        const ch = String.fromCharCode(buffer[i]);
        // A CR ends the record on its own; a following LF is part of the same
        // CRLF break and is skipped rather than producing an empty record.
        if (pendingCR) {
          pendingCR = false;
          if (ch === '\n') continue;
        }
        if (inQuotes) {
          if (ch === '"') {
            if (i + 1 < bytesRead && buffer[i + 1] === 34) { i++; field += '"'; continue; }
            inQuotes = false;
          } else field += ch;
          continue;
        }
        if (ch === '"' && !hasField) { inQuotes = true; hasField = true; continue; }
        if (ch === ',') { record.push(field); field = ''; hasField = false; continue; }
        if (ch === '\r') { pendingCR = true; record.push(field); if (record.length > 1 || record[0] !== '') yield record; record = []; field = ''; hasField = false; continue; }
        if (ch === '\n') {
          record.push(field);
          if (record.length > 1 || record[0] !== '') yield record;
          record = []; field = ''; hasField = false;
          continue;
        }
        field += ch;
        hasField = true;
      }
    }
  } finally {
    closeSync(fd);
  }
  if (field !== '' || record.length > 0) { record.push(field); yield record; }
}

// ---------------------------------------------------------------------------
// Language detector. Counts rows, decides nothing.
// ---------------------------------------------------------------------------

const TL_MARKERS = new Set([
  'ang', 'ng', 'mga', 'ako', 'ikaw', 'kami', 'tayo', 'sila', 'ito', 'iyon', 'iyong', 'siya',
  'para', 'kasi', 'kaya', 'naman', 'lang', 'din', 'rin', 'ba', 'na', 'san', 'hindi', 'wala',
  'may', 'meron', 'ginawa', 'bibili', 'gagawin', 'pwede', 'puwede', 'kailangan', 'gusto',
  'ayaw', 'bakit', 'saan', 'ano', 'sino', 'ilan', 'kano', 'paano', 'kapag', 'kung', 'habang',
  'bago', 'pagkatapos', 'tungkol', 'napaka', 'sobrang', 'mabuti', 'ganda', 'mahal', 'bata',
]);
const EN_MARKERS = new Set([
  'the', 'and', 'with', 'for', 'from', 'your', 'you', 'are', 'this', 'that', 'have', 'sell',
  'selling', 'price', 'listing', 'shipping', 'available', 'condition', 'custom', 'made', 'size',
  'new', 'used', 'worn', 'complete', 'ready', 'order', 'this',
]);

function langOf(text: string): 'tl' | 'taglish' | 'en' | 'unknown' {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return 'unknown';
  let tl = 0;
  let en = 0;
  for (const w of words) {
    if (TL_MARKERS.has(w)) tl++;
    if (EN_MARKERS.has(w)) en++;
  }
  if (tl >= 2 && tl > en) return 'tl';
  if (tl >= 1 && en >= 1 && tl / (tl + en) >= 0.2) return 'taglish';
  if (en >= 2) return 'en';
  return 'unknown';
}

const CLASSES = ['clean', 'vulgar', 'hate', 'adult', 'prohibited', 'unrelated'] as const;

// ---------------------------------------------------------------------------
// processed/*.csv
// ---------------------------------------------------------------------------

for (const file of ['train.csv', 'test.csv', 'val.csv']) {
  const path = join(AI, 'processed', file);
  let rows = 0;
  const byLangClass = new Map<string, number>();
  const perClass = new Map<string, number>();
  let headerSkipped = false;
  for (const record of csvRecords(path)) {
    if (!headerSkipped) {
      headerSkipped = true;
      if (record[0] === 'id') continue;
    }
    // id,text,field,source,clean,vulgar,hate,adult,prohibited,unrelated
    if (record.length < 10) continue;
    const text = record[1];
    const flags = record.slice(4, 10);
    const active: string[] = [];
    CLASSES.forEach((name, i) => {
      if (String(flags[i]).trim() === '1') active.push(name);
    });
    if (active.length === 0) continue;
    rows++;
    const lang = langOf(text);
    const primary = active[0];
    byLangClass.set(`${lang}/${primary}`, (byLangClass.get(`${lang}/${primary}`) ?? 0) + 1);
    perClass.set(primary, (perClass.get(primary) ?? 0) + 1);
  }
  console.log(`--- processed/${file} ---`);
  console.log(`  rows with a class flag: ${rows}`);
  console.log(`  per class: ${[...perClass.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  per language: ${['en', 'tl', 'taglish', 'unknown'].map((l) => {
    let total = 0;
    for (const [k, v] of byLangClass) if (k.startsWith(`${l}/`)) total += v;
    return `${l}=${total}`;
  }).join(' ')}`);
  console.log(`  per language per class:`);
  for (const l of ['tl', 'taglish']) {
    const parts: string[] = [];
    for (const c of CLASSES) {
      parts.push(`${c}=${byLangClass.get(`${l}/${c}`) ?? 0}`);
    }
    console.log(`    ${l}: ${parts.join(' ')}`);
  }
}

// ---------------------------------------------------------------------------
// labeled_listings.jsonl
// ---------------------------------------------------------------------------

{
  const path = join(ROOT, 'data', 'labeled_listings.jsonl');
  const perLang = new Map<string, { allowed: number; blocked: number }>();
  let rows = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let row: { text?: string; label?: string };
    try { row = JSON.parse(line); } catch { continue; }
    rows++;
    const lang = langOf(row.text ?? '');
    const entry = perLang.get(lang) ?? { allowed: 0, blocked: 0 };
    if (row.label === 'allowed') entry.allowed++; else entry.blocked++;
    perLang.set(lang, entry);
  }
  console.log('--- data/labeled_listings.jsonl ---');
  console.log(`  rows: ${rows}`);
  for (const [lang, e] of [...perLang.entries()].sort()) {
    console.log(`  ${lang}: allowed=${e.allowed} blocked=${e.blocked} total=${e.allowed + e.blocked}`);
  }
}

// ---------------------------------------------------------------------------
// The shipped generated terms.
// ---------------------------------------------------------------------------

{
  const file = JSON.parse(readFileSync(join(ROOT, 'src/moderation/data/blocked_terms.json'), 'utf8')) as {
    terms: { term: string; category: string }[];
  };
  console.log('--- src/moderation/data/blocked_terms.json ---');
  console.log(`  terms: ${file.terms.length}`);
  const byCat = new Map<string, number>();
  let tagalog = 0;
  for (const t of file.terms) {
    byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);
    const words = (t.term.match(/[a-z']+/g) ?? []).map((w) => w);
    if (words.length > 0 && words.every((w) => TL_MARKERS.has(w))) tagalog++;
  }
  console.log(`  by category: ${[...byCat.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  terms that are Tagalog words only: ${tagalog}`);
}

// ---------------------------------------------------------------------------
// What class vocabulary the existing rules already know, counted not printed.
// ---------------------------------------------------------------------------

console.log('--- existing rule modules ---');
const ruleFiles = ['adult', 'hate', 'prohibited', 'vulgar', 'unrelated', 'cosplayTerms', 'allowlist'];
for (const name of ruleFiles) {
  try {
    const src = readFileSync(join(ROOT, 'src/moderation/rules', `${name}.ts`), 'utf8');
    const quoted = src.match(/'[^'\n]{1,80}'/g) ?? [];
    console.log(`  ${name}.ts: ${quoted.length} quoted entries`);
  } catch {
    console.log(`  ${name}.ts: not found`);
  }
}
/**
 * TEMPORARY diagnostic. Aggregates only: never prints a term, a row or text.
 * Classifies HOW each clean-row hit was matched: exact token, squash-fold, or phrase.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWord, toTarget, toWords, type CompiledWord } from '../src/moderation/normalize';
import { languageTermMatches } from '../src/moderation/rules/languageTerms';
import { readLabeled, readProcessed, tokensOf, type Row } from './build-language-terms';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASETS = join(ROOT, '..', 'forgemind-ai', 'marketplace_datasets');
const CAP = 5000;

const meta = new Map<string, { source: string; cls: string; lang: string }>();
for (const [file, lang] of [['blocked_terms_en.json', 'en'], ['blocked_terms_tl.json', 'tl']] as const) {
  const parsed = JSON.parse(readFileSync(join(ROOT, 'src', 'moderation', 'data', file), 'utf8'));
  for (const row of parsed.terms ?? []) {
    meta.set(String(row.term), { source: String(row.source), cls: String(row.class), lang });
  }
}

const rows: Row[] = [
  ...readProcessed(join(DATASETS, 'processed', 'train.csv')).filter((r) => !r.selected),
  ...readProcessed(join(DATASETS, 'processed', 'test.csv'), true),
  ...readLabeled(join(ROOT, 'data', 'labeled_listings.jsonl')).filter((r) => !r.selected),
];

const byWay: Record<string, number> = {};
const byWaySource: Record<string, number> = {};
const distinct = new Set<string>();
const distinctByWay = new Map<string, Set<string>>();
let scored = 0;
let rowsWithHit = 0;
let exactSeen = 0;
let squashSeen = 0;
let phraseSeen = 0;

function bump(obj: Record<string, number>, k: string) {
  obj[k] = (obj[k] ?? 0) + 1;
}

for (const row of rows) {
  if (row.cls !== 'clean') continue;
  if (scored >= CAP) break;
  scored += 1;
  const target = toTarget(row.text);
  const hits = languageTermMatches(target);
  if (hits.length === 0) continue;
  rowsWithHit += 1;
  const exact = new Set(tokensOf(row.text));
  const rowSquashed = new Set(toWords(target.spaced).map((w) => compileWord(w).squashed));
  const phraseHeads = new Set(target.spaced.split(' '));
  for (const hit of hits as CompiledWord[]) {
    const m = meta.get(hit.spaced) ?? { source: 'unknown', cls: 'unknown', lang: 'unknown' };
    let way: string;
    if (exact.has(hit.spaced)) {
      way = 'exact_token';
      exactSeen += 1;
    } else if (rowSquashed.has(compileWord(hit.spaced).squashed)) {
      way = 'squash_fold';
      squashSeen += 1;
    } else if (hit.spaced.includes(' ') && phraseHeads.has(hit.spaced.split(' ')[0])) {
      way = 'phrase';
      phraseSeen += 1;
    } else {
      way = 'other';
    }
    bump(byWay, way);
    bump(byWaySource, `${way}|${m.source}|${m.cls}`);
    distinct.add(hit.spaced);
    if (!distinctByWay.has(way)) distinctByWay.set(way, new Set());
    distinctByWay.get(way)!.add(hit.spaced);
  }
}

console.log(`rows_scored=${scored} rows_with_hit=${rowsWithHit} distinct_terms=${distinct.size}`);
console.log(`exact_token=${exactSeen} squash_fold=${squashSeen} phrase=${phraseSeen} unexplained=${byWay.other ?? 0}`);
console.log(`distinct_by_way=${JSON.stringify([...distinctByWay].map(([k, v]) => [k, v.size]))}`);
console.log('way_source_class=');
for (const [k, v] of Object.entries(byWaySource).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${k}: ${v}`);
}

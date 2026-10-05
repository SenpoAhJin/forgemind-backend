/**
 * Measures the per-language term lists on rows they were not selected from.
 *
 * Run with: npx tsx scripts/measure-language-terms.ts
 *
 * TWO NUMBERS, PER LANGUAGE
 *   block rate    - how many rows the corpus calls non-clean end up blocked by
 *                   `moderateListing`. This is the recall the task asks for.
 *   false-block   - how many rows the corpus calls clean end up blocked. This is
 *                   the cost, and the number that decides whether the list may
 *                   ship at all.
 *
 * WHAT IS AND IS NOT SCORED
 * Only held-back rows are scored: the test split in full, plus every fifth row
 * of the train split and of the labeled file. A row that had any part in choosing
 * a term would score the list on its own evidence and always look good.
 *
 * UP TO 20,000 CLEAN ROWS PER LANGUAGE
 * The clean side is capped so the two languages are compared on the same
 * footing: the corpus is overwhelmingly English, and letting all of it through
 * would bury the Tagalog number in a denominator it cannot move.
 *
 * NOTHING SENSITIVE IS EVER PRINTED
 * Counts, rates and class names only. A term, a listing title or a comment body
 * never reaches the terminal.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { moderateListing } from '../src/moderation/index';
import { PERMITTED_CATEGORY_SLUGS } from '../src/moderation/rules';
import { languageOf, readLabeled, readProcessed, type Row } from './build-language-terms';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASETS = join(ROOT, '..', 'forgemind-ai', 'marketplace_datasets');

/** Clean rows scored per language, so both languages are compared alike. */
const CLEAN_SAMPLE_PER_LANGUAGE = 20000;

/** Category used for every scored row. Relevance is not what is being measured. */
const CATEGORY = PERMITTED_CATEGORY_SLUGS[0];

interface Bucket {
  rows: number;
  blocked: number;
}

function bucket(): Bucket {
  return { rows: 0, blocked: 0 };
}

function record(into: Bucket, blocked: boolean): void {
  into.rows += 1;
  if (blocked) into.blocked += 1;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return `${((part / whole) * 100).toFixed(3)}%`;
}

/**
 * A row becomes a listing title and description.
 *
 * The title is a short fixed prefix and the description carries the row, because
 * moderation reads both fields and a row that only ever reached one of them
 * would be scored on less than a real listing.
 */
function asListing(text: string): { title: string; description: string; category: string } {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const title = trimmed.length > 100 ? trimmed.slice(0, 100) : trimmed;
  const description = trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
  return { title, description, category: CATEGORY };
}

/**
 * Scores held-back non-clean rows: how many end up blocked, per language.
 *
 * Every held-back non-clean row is scored, not capped. These are the rows the
 * list is supposed to catch, and there are few enough of them that sampling
 * would only hide the language with the least data.
 */
function scoreNonClean(rows: Row[]): Record<string, Bucket> {
  const out: Record<string, Bucket> = {};
  for (const row of rows) {
    const into = (out[row.lang] ??= bucket());
    const result = moderateListing(asListing(row.text));
    record(into, !result.allowed);
  }
  return out;
}

/**
 * Scores held-back clean rows, up to the cap per language.
 *
 * The cap keeps the two languages comparable: the corpus is overwhelmingly
 * English, and scoring all of it would bury the Tagalog number in a denominator
 * it cannot move. Rows beyond the cap are counted in `outOfScope` so the report
 * can say how much was skipped.
 */
function scoreClean(rows: Row[]): Record<string, Bucket> {
  const out: Record<string, Bucket> = {};
  for (const row of rows) {
    const into = (out[row.lang] ??= bucket());
    if (into.rows >= CLEAN_SAMPLE_PER_LANGUAGE) continue;
    const result = moderateListing(asListing(row.text));
    record(into, !result.allowed);
  }
  return out;
}

function report(label: string, side: Record<string, Bucket>): void {
  for (const lang of Object.keys(side).sort()) {
    const b = side[lang];
    console.log(
      `${label} lang=${lang} rows=${b.rows} blocked=${b.blocked} rate=${pct(b.blocked, b.rows)}`,
    );
  }
  if (Object.keys(side).length === 0) console.log(`${label} rows=0`);
}

function main(): void {
  // Only held-back rows reach the scorer. `readProcessed(f)` marks every fifth
  // train row held back; the test split is held back in full.
  const trainHeldBack = readProcessed(join(DATASETS, 'processed', 'train.csv')).filter((r) => !r.selected);
  const testAll = readProcessed(join(DATASETS, 'processed', 'test.csv'), true);
  const labeledHeldBack = readLabeled(join(ROOT, 'data', 'labeled_listings.jsonl')).filter((r) => !r.selected);

  const heldBack = [...trainHeldBack, ...testAll, ...labeledHeldBack];
  const heldOutNonClean = heldBack.filter((r) => r.cls !== 'clean');
  const heldOutClean = heldBack.filter((r) => r.cls === 'clean');

  if (!existsSync(join(ROOT, 'src', 'moderation', 'data', 'blocked_terms_en.json'))) {
    console.log('missing src/moderation/data/blocked_terms_en.json; run build-language-terms first');
    return;
  }

  console.log(
    `held_out non_clean_rows=${heldOutNonClean.length} clean_rows=${heldOutClean.length} ` +
      `clean_sample_cap_per_language=${CLEAN_SAMPLE_PER_LANGUAGE}`,
  );

  const nonCleanSide = scoreNonClean(heldOutNonClean);
  const cleanSide = scoreClean(heldOutClean);

  report('non_clean', nonCleanSide);
  report('clean', cleanSide);
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

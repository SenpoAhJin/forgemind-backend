/**
 * Chooses which generated terms are safe to block, using the labeled set.
 *
 *   npx ts-node scripts/analyze-term-selection.ts
 *
 * THE PROBLEM THIS SOLVES
 * The corpus of blocked rows is not a list of words. Most of its entries are whole
 * sentences, and plenty of them are ordinary phrasing that also appears in perfectly
 * innocent writing. Feeding every entry to the screener therefore raises recall and
 * destroys precision at the same time. A list that blocks more than half of the
 * rows labeled allowed is not a stricter screener, it is a broken one.
 *
 * WHAT IT DOES
 * One pass over the labeled set records, for every row, which candidate terms it
 * matched. Every selection rule below can then be scored from that single pass,
 * without screening the corpus again, and each rule is chosen on the selection
 * split and scored on the held-back split so the numbers are not self-fulfilling.
 *
 * CANDIDATES COMPARED
 *   all                 every candidate term
 *   single              single-word candidates only, since a sentence is not a term
 *   pure                seen in a blocked row and never in an allowed row
 *   pure:minN           the same, but the term must also back at least N blocked rows
 *   ratio:1/k           allowed-row hits under 1/k of the term's blocked-row hits
 *
 * OUTPUT
 * Counts, percentages and term totals per configuration. Never a term, never a row.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { moderateListing } from '../src/moderation';
import { buildTermIndex, compileWord, indexMatches, toTarget } from '../src/moderation/normalize';
import { LIMITS } from '../src/moderation/rules';

/** A marketplace listing has no "other" category, so relevance is measured out of the way. */
const MEASUREMENT_CATEGORY = 'Other';

/** Must match the split in scripts/build-moderation-data.ts. */
const HOLDOUT_EVERY = 5;

/** The rules that judge wording. UNRELATED is a relevance rule and is measured apart. */
const LANGUAGE_CODES = new Set(['VULGAR', 'ADULT', 'HATE', 'PROHIBITED_ITEM', 'BLOCKED_TERM']);

/** A term has to back this many blocked rows before it is trusted on zero allowed evidence. */
const MIN_BLOCKED_HITS = [1, 2, 3, 5, 10, 25] as const;

/**
 * Whether rows that came from the term batches count as evidence.
 *
 * `false` is the honest setting: a term always matches the row it was taken from,
 * so letting those rows vote would let every term vouch for itself.
 */
const COUNT_SELF_REFERRENTIAL_ROWS = process.env.SELF_REFERRENTIAL === '1';

/** Allowed-row hits allowed per blocked-row hit. */
const RATIO_STEPS = [10, 3, 1] as const;

const REPO_ROOT = path.resolve(__dirname, '..');
const CANDIDATES_PATH = path.join(REPO_ROOT, 'data', 'blocked_terms_candidates.json');
const LABELED_PATH = path.join(REPO_ROOT, 'data', 'labeled_listings.jsonl');

interface CandidateFile {
  candidates?: number;
  terms?: Array<{ term: string; category: string }>;
}

interface RowRecord {
  blockedByLabel: boolean;
  blockedByLanguage: boolean;
  held: boolean;
  screened: boolean;
  /** Positions in the term array, deduplicated. */
  hits: number[];
}

interface Score {
  correct: number;
  missed: number;
  wrong: number;
  labeledBlocked: number;
}

function percent(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return ((part / whole) * 100).toFixed(2);
}

function score(rows: RowRecord[], keep: (id: number) => boolean): Score {
  let correct = 0;
  let wrong = 0;
  let labeledBlocked = 0;

  for (const row of rows) {
    if (row.blockedByLabel) labeledBlocked += 1;
    if (!row.blockedByLanguage && !(row.screened && row.hits.some(keep))) continue;
    if (row.blockedByLabel) correct += 1;
    else wrong += 1;
  }

  return { correct, missed: labeledBlocked - correct, wrong, labeledBlocked };
}

async function main(): Promise<void> {
  for (const file of [CANDIDATES_PATH, LABELED_PATH]) {
    if (!fs.existsSync(file)) {
      throw new Error(`${path.relative(REPO_ROOT, file)} not found. Run scripts/build-moderation-data.ts first.`);
    }
  }

  const candidates = (JSON.parse(fs.readFileSync(CANDIDATES_PATH, 'utf8')) as CandidateFile).terms ?? [];
  const compiled = candidates.map((entry) => compileWord(entry.term));
  const index = buildTermIndex(compiled);
  const termId = new Map<string, number>();
  compiled.forEach((term, id) => termId.set(term.spaced, id));
  const totalTerms = compiled.length;

  const isPhrase = new Uint8Array(totalTerms);
  compiled.forEach((term, id) => {
    isPhrase[id] = term.spaced.includes(' ') ? 1 : 0;
  });

  /** Hits counted on the split that chooses the terms. */
  const selectionBlocked = new Int32Array(totalTerms);
  const selectionAllowed = new Int32Array(totalTerms);

  const rows: RowRecord[] = [];
  const input = fs.createReadStream(LABELED_PATH, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let position = 0;

  for await (const line of lines) {
    if (line === '') continue;
    const row = JSON.parse(line) as { text: string; label: 'blocked' | 'allowed'; source?: string };
    const blockedByLabel = row.label === 'blocked';
    const held = position % HOLDOUT_EVERY === 0;
    position += 1;
    const screened = row.text.length <= LIMITS.descriptionMax;

    const result = moderateListing({ title: '', description: row.text, category: MEASUREMENT_CATEGORY });
    const blockedByLanguage = result.violations.some(
      (violation) => violation.code !== 'BLOCKED_TERM' && LANGUAGE_CODES.has(violation.code),
    );

    const hits: number[] = [];
    if (screened) {
      const seen = new Set<number>();
      for (const term of indexMatches(toTarget(row.text), index)) {
        const id = termId.get(term.spaced);
        if (id === undefined || seen.has(id)) continue;
        seen.add(id);
        hits.push(id);
        if (held) continue;
        if (!COUNT_SELF_REFERRENTIAL_ROWS && row.source === 'term_batch') continue;
        if (blockedByLabel) selectionBlocked[id] += 1;
        else selectionAllowed[id] += 1;
      }
    }

    rows.push({ blockedByLabel, blockedByLanguage, held, screened, hits });
  }

  const holdout = rows.filter((row) => row.held);
  const configs: Array<{ name: string; keep: (id: number) => boolean }> = [
    { name: 'all', keep: () => true },
    { name: 'single', keep: (id) => isPhrase[id] === 0 },
    ...MIN_BLOCKED_HITS.map((min) => ({
      name: `pure:min${min}`,
      keep: (id: number) => selectionAllowed[id] === 0 && selectionBlocked[id] >= min,
    })),
    ...RATIO_STEPS.map((step) => ({
      name: `ratio:${step}`,
      keep: (id: number) => selectionBlocked[id] > 0 && selectionAllowed[id] * step <= selectionBlocked[id],
    })),
  ];

  for (const config of configs) {
    let keptTerms = 0;
    for (let id = 0; id < totalTerms; id += 1) if (config.keep(id)) keptTerms += 1;

    const all = score(rows, config.keep);
    const held = score(holdout, config.keep);
    const base = score(holdout, () => false);

    console.log(
      `config=${config.name} terms_kept=${keptTerms} ` +
        `all: correct=${all.correct} missed=${all.missed} wrong=${all.wrong} ` +
        `precision=${percent(all.correct, all.correct + all.wrong)}% recall=${percent(all.correct, all.labeledBlocked)}%`,
    );
    console.log(
      `config=${config.name} holdout: baseline_correct=${base.correct} baseline_missed=${base.missed} baseline_wrong=${base.wrong} ` +
        `correct=${held.correct} missed=${held.missed} wrong=${held.wrong} ` +
        `missed_delta=${held.missed - base.missed} wrong_delta=${held.wrong - base.wrong} ` +
        `precision=${percent(held.correct, held.correct + held.wrong)}% recall=${percent(held.correct, held.labeledBlocked)}%`,
    );
  }

  const baselineAll = score(rows, () => false);
  const baselineHoldout = score(holdout, () => false);
  console.log(
    `terms candidates=${totalTerms} single_word=${isPhrase.reduce((sum, flag) => sum + (flag === 0 ? 1 : 0), 0)} ` +
      `phrase=${isPhrase.reduce((sum, flag) => sum + flag, 0)} ` +
      `self_referential_rows_counted=${COUNT_SELF_REFERRENTIAL_ROWS}`,
  );
  console.log(
    `rows total=${rows.length} labeled_blocked=${baselineAll.labeledBlocked} labeled_allowed=${rows.length - baselineAll.labeledBlocked} ` +
      `holdout_rows=${holdout.length} holdout_labeled_blocked=${baselineHoldout.labeledBlocked} ` +
      `not_screened=${rows.filter((row) => !row.screened).length}`,
  );
  console.log(
    `summary baseline_all_missed=${baselineAll.missed} baseline_all_wrong=${baselineAll.wrong} ` +
      `baseline_holdout_missed=${baselineHoldout.missed} baseline_holdout_wrong=${baselineHoldout.wrong}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
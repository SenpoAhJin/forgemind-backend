/**
 * Measures the marketplace screener against the labeled set.
 *
 *   npx ts-node scripts/measure-screener.ts
 *
 * WHAT IT ANSWERS
 * Two numbers decide whether the screener is worth shipping: how much blocked
 * content it lets through, and how much innocent content it blocks. A change that
 * improves the first while quietly worsening the second is not an improvement,
 * which is why both are printed from the same run.
 *
 * THREE VIEWS, BECAUSE ONE NUMBER LIES
 *
 *   relevance  Every rule. The labeled rows are general discussion text, not
 *              cosplay listings, so most of them are genuinely unrelated to this
 *              marketplace and the relevance rule is right to refuse them. Counting
 *              those refusals as errors would make the numbers describe the corpus
 *              rather than the screener, so this view is reported for completeness
 *              and not acted on.
 *
 *   language   Only the rules about wording: profanity, adult content, hate,
 *              prohibited goods and the generated term list. This is the view the
 *              generated list can actually move, and it is the one the decision
 *              rests on.
 *
 *   holdout    The language view again, restricted to the rows the term list was
 *              not chosen from. Selection and scoring cannot share every row, or
 *              the score is just a description of how the terms were picked.
 *
 * HOW THE LABELS ARE USED
 * `data/labeled_listings.jsonl` carries one {text, label} object per line, built by
 * scripts/build-moderation-data.ts. Each row is screened exactly the way a listing
 * description is screened, so the measurement runs the production function rather
 * than a reimplementation of it.
 *
 * THE TWO PASSES COME OUT OF ONE CALL
 * `moderateListing` reports one violation per rule that fired, so a row blocked only
 * by the generated term list produces a BLOCKED_TERM code and nothing else. That is
 * what makes "before" (curated rules alone) and "after" (curated rules plus the
 * generated list) separable without screening the corpus twice.
 *
 * NOTHING IS EVER PRINTED
 * Counts, percentages and term categories only. Not one row body, not one term,
 * not one matched category value that came from a row. A screener whose measurement
 * output could be used to reconstruct its own list is a screener that can be beaten
 * by anyone who can read a log.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { moderateListing } from '../src/moderation';
import { indexMatches, toTarget } from '../src/moderation/normalize';
import {
  blockedTermCategory,
  blockedTermCount,
  blockedTermCountByCategory,
  blockedTermDroppedCount,
  blockedTermIndex,
  blockedTermSchemaVersion,
} from '../src/moderation/rules/blockedTerms';
import { LIMITS } from '../src/moderation/rules';

/** A marketplace listing has no "other" category, so relevance is measured out of the way. */
const MEASUREMENT_CATEGORY = 'Other';

/** Must match the split in scripts/build-moderation-data.ts, or the holdout view is meaningless. */
const HOLDOUT_EVERY = 5;

const LABELED_PATH = path.resolve(__dirname, '..', 'data', 'labeled_listings.jsonl');

/** The rules that judge wording. UNRELATED is a relevance rule and is measured apart. */
const LANGUAGE_CODES = new Set(['VULGAR', 'ADULT', 'HATE', 'PROHIBITED_ITEM', 'BLOCKED_TERM']);

interface Tally {
  rows: number;
  labeledBlocked: number;
  labeledAllowed: number;
  notScreened: number;
  beforeCorrect: number;
  beforeMissed: number;
  beforeWrong: number;
  afterCorrect: number;
  afterMissed: number;
  afterWrong: number;
  /** Rows the generated list newly blocked that are labeled allowed, by batch. */
  wrongByCategory: Map<string, number>;
  /** Rows the generated list newly blocked that are labeled blocked, by batch. */
  rescuedByCategory: Map<string, number>;
}

function newTally(): Tally {
  return {
    rows: 0,
    labeledBlocked: 0,
    labeledAllowed: 0,
    notScreened: 0,
    beforeCorrect: 0,
    beforeMissed: 0,
    beforeWrong: 0,
    afterCorrect: 0,
    afterMissed: 0,
    afterWrong: 0,
    wrongByCategory: new Map(),
    rescuedByCategory: new Map(),
  };
}

function record(
  tally: Tally,
  isBlocked: boolean,
  before: boolean,
  after: boolean,
  generatedOnly: boolean,
  categories: Set<string>,
): void {
  tally.rows += 1;
  if (isBlocked) tally.labeledBlocked += 1;
  else tally.labeledAllowed += 1;

  if (before) {
    if (isBlocked) tally.beforeCorrect += 1;
    else tally.beforeWrong += 1;
  } else if (isBlocked) {
    tally.beforeMissed += 1;
  }

  if (after) {
    if (isBlocked) tally.afterCorrect += 1;
    else tally.afterWrong += 1;
  } else if (isBlocked) {
    tally.afterMissed += 1;
  }

  if (!generatedOnly) return;
  const bucket = isBlocked ? tally.rescuedByCategory : tally.wrongByCategory;
  for (const category of categories) bucket.set(category, (bucket.get(category) ?? 0) + 1);
}

function percent(part: number, whole: number): string {
  if (whole === 0) return 'n/a';
  return ((part / whole) * 100).toFixed(2);
}

function report(name: string, tally: Tally): void {
  console.log(
    `view=${name} rows=${tally.rows} labeled_blocked=${tally.labeledBlocked} labeled_allowed=${tally.labeledAllowed} ` +
      `not_screened=${tally.notScreened}`,
  );
  console.log(
    `view=${name} before correct=${tally.beforeCorrect} missed=${tally.beforeMissed} wrong=${tally.beforeWrong} ` +
      `precision=${percent(tally.beforeCorrect, tally.beforeCorrect + tally.beforeWrong)}% ` +
      `recall=${percent(tally.beforeCorrect, tally.labeledBlocked)}%`,
  );
  console.log(
    `view=${name} after  correct=${tally.afterCorrect} missed=${tally.afterMissed} wrong=${tally.afterWrong} ` +
      `precision=${percent(tally.afterCorrect, tally.afterCorrect + tally.afterWrong)}% ` +
      `recall=${percent(tally.afterCorrect, tally.labeledBlocked)}%`,
  );
  const byCategory = (map: Map<string, number>): string =>
    map.size === 0 ? 'none' : [...map.entries()].map(([key, value]) => `${key}:${value}`).join(' ');
  console.log(`view=${name} newly_wrong_by_category=${byCategory(tally.wrongByCategory)}`);
  console.log(`view=${name} newly_correct_by_category=${byCategory(tally.rescuedByCategory)}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(LABELED_PATH)) {
    throw new Error(`labeled set not found: ${LABELED_PATH}. Run scripts/build-moderation-data.ts first.`);
  }

  const language = newTally();
  const relevance = newTally();
  const holdout = newTally();
  const index = blockedTermIndex();

  const input = fs.createReadStream(LABELED_PATH, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let position = 0;

  for await (const line of lines) {
    if (line === '') continue;
    const row = JSON.parse(line) as { text: string; label: 'blocked' | 'allowed' };
    const isBlocked = row.label === 'blocked';
    const held = position % HOLDOUT_EVERY === 0;
    position += 1;

    // The screener ignores a field it could not have stored anyway. Those rows are
    // counted so the miss total is honest about what was never inspected.
    const screened = row.text.length <= LIMITS.descriptionMax;
    if (!screened) language.notScreened += 1;

    const result = moderateListing({ title: '', description: row.text, category: MEASUREMENT_CATEGORY });
    const generatedHit = screened && result.violations.some((violation) => violation.code === 'BLOCKED_TERM');

    const curated = result.violations.filter((violation) => violation.code !== 'BLOCKED_TERM');
    const curatedLanguage = curated.filter((violation) => LANGUAGE_CODES.has(violation.code));

    // Categories of the terms that fired, used only to attribute a row to a batch.
    const categories = new Set<string>();
    if (generatedHit) {
      for (const term of indexMatches(toTarget(row.text), index)) {
        categories.add(blockedTermCategory(term.spaced) ?? 'uncategorized');
      }
    }
    const generatedOnly = generatedHit && curatedLanguage.length === 0;

    record(language, isBlocked, curatedLanguage.length > 0, curatedLanguage.length > 0 || generatedHit, generatedOnly, categories);
    record(relevance, isBlocked, curated.length > 0, curated.length > 0 || generatedHit, generatedOnly, categories);
    if (held) record(holdout, isBlocked, curatedLanguage.length > 0, curatedLanguage.length > 0 || generatedHit, generatedOnly, categories);
    if (!screened) holdout.notScreened += 1;
  }

  const index0 = blockedTermIndex();
  console.log(
    `terms usable=${blockedTermCount()} dropped_unmatchable=${blockedTermDroppedCount()} ` +
      `single_word=${index0.singleCount} phrase=${index0.phraseCount} schema_version=${blockedTermSchemaVersion()}`,
  );
  console.log(
    `terms by_category=${Object.entries(blockedTermCountByCategory())
      .map(([key, value]) => `${key}:${value}`)
      .join(' ')}`,
  );
  console.log(`rows screened_total=${language.rows} not_screened_over_description_max_${LIMITS.descriptionMax}=${language.notScreened}`);

  report('language_all_rows', language);
  report('language_holdout_rows', holdout);
  report('relevance_all_rows', relevance);

  console.log(
    `summary language_all precision_before=${percent(language.beforeCorrect, language.beforeCorrect + language.beforeWrong)}% ` +
      `precision_after=${percent(language.afterCorrect, language.afterCorrect + language.afterWrong)}% ` +
      `recall_before=${percent(language.beforeCorrect, language.labeledBlocked)}% ` +
      `recall_after=${percent(language.afterCorrect, language.labeledBlocked)}% ` +
      `missed_before=${language.beforeMissed} missed_after=${language.afterMissed} ` +
      `wrong_before=${language.beforeWrong} wrong_after=${language.afterWrong}`,
  );
  console.log(
    `summary language_holdout precision_before=${percent(holdout.beforeCorrect, holdout.beforeCorrect + holdout.beforeWrong)}% ` +
      `precision_after=${percent(holdout.afterCorrect, holdout.afterCorrect + holdout.afterWrong)}% ` +
      `recall_before=${percent(holdout.beforeCorrect, holdout.labeledBlocked)}% ` +
      `recall_after=${percent(holdout.afterCorrect, holdout.labeledBlocked)}% ` +
      `missed_before=${holdout.beforeMissed} missed_after=${holdout.afterMissed} ` +
      `wrong_before=${holdout.beforeWrong} wrong_after=${holdout.afterWrong}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
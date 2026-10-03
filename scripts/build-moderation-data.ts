/**
 * Builds the marketplace moderation data files from the raw CSV batches.
 *
 *   npx ts-node scripts/build-moderation-data.ts
 *
 * WHY A BUILD STEP
 * The source batches are large CSVs that live outside this repository and are
 * gitignored upstream. Baking their contents into hand-written TypeScript would
 * make the rule lists unreviewable and impossible to regenerate, so the terms are
 * compiled once into src/moderation/data/blocked_terms.json and the labeled rows
 * into data/labeled_listings.jsonl. Both are outputs, both are reproducible with
 * this one command.
 *
 * WHY THE CANDIDATE LIST IS MOSTLY THROWN AWAY
 * The blocked rows are not a word list. Most of their entries are whole sentences,
 * and a surprising number of those sentences are ordinary phrasing that also shows
 * up in innocent writing. Screening on all of them was measured on this same
 * labeled set and blocked more than half of the rows labeled allowed, which is not
 * a stricter screener but a broken one. So the candidate terms are filtered against
 * the labeled rows and only the ones that actually earn their place are shipped.
 *
 * WHY THE FILTER DOES NOT SEE THE WHOLE SET
 * Selection and measurement cannot share every row. The rows are split by position
 * in the file, four of every five go to selection and the fifth is held back, so the
 * reported numbers are measured on rows the term list was not chosen from. Selecting
 * on the same rows that are then scored always looks better than it is.
 *
 * ORIGINALS ARE NEVER TOUCHED
 * Every input file is opened read-only and nothing is written outside the three
 * output paths. There is no move, no rename and no delete anywhere in this file.
 *
 * NOTHING SENSITIVE IS EVER PRINTED
 * This script prints counts, lengths and column names only. A term, a listing
 * title or a comment body is data the screener exists to keep out of the
 * marketplace, so it must not end up in a terminal scrollback, a CI log or a
 * commit message. Cells are read into memory and written straight back out.
 *
 * OUTPUT 1 - src/moderation/data/blocked_terms.json
 *   The selected terms: lowercased, trimmed, de-duplicated, one entry per distinct
 *   term, each tagged with the batch it came from and how the selection ran.
 *
 * OUTPUT 2 - data/labeled_listings.jsonl
 *   One JSON object per line: { "text": string, "label": "blocked" | "allowed" }.
 *   De-duplicated on the normalized text. Any text that carries both labels is
 *   dropped entirely, because a row that is both blocked and allowed has no
 *   correct answer and would only add noise to the measurement.
 *
 * OUTPUT 3 - data/blocked_terms_candidates.json
 *   The unfiltered candidate list, kept so the selection study can be repeated
 *   without re-reading the raw batches. Gitignored with the other data outputs.
 */

import fs from 'node:fs';
import path from 'node:path';

import { buildTermIndex, compileWord } from '../src/moderation/normalize';
import { indexMatches, toTarget } from '../src/moderation/normalize';

/** Schema version of blocked_terms.json. Bumped when the shape changes. */
const TERMS_SCHEMA_VERSION = 2;

/** Every HOLDOUT_EVERY rows go to the held-back split; the rest choose the terms. */
const HOLDOUT_EVERY = 5;

/**
 * A term has to back at least this many independently labeled blocked rows.
 *
 * One hit is not evidence. The single-column batches also supply the terms, so a
 * term with a single blocked hit is usually just its own source row agreeing with
 * itself. Requiring repeated independent evidence is what lets a term be kept
 * without also being a source of false blocks.
 */
const MIN_BLOCKED_HITS = 5;

/** Server caps. A row longer than these cannot be stored, so it cannot be screened. */
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 2000;

/**
 * Where the raw batches live, relative to this file.
 *
 * Overridable with MARKETPLACE_DATASETS_DIR so the script can run against a copy
 * somewhere else without editing it.
 */
const DEFAULT_DATASETS_DIR = path.resolve(__dirname, '..', '..', 'forgemind-ai', 'marketplace_datasets');

const REPO_ROOT = path.resolve(__dirname, '..');

/** Single-column batches that hold terms only. No label column exists in them. */
const TERM_BATCHES: ReadonlyArray<{ file: string; category: string }> = [
  { file: 'Block_Words_Part1_0a5e31bd.csv', category: 'part1' },
  { file: 'Block_Words_Part1_0a5e31bd (1).csv', category: 'part1' },
  { file: 'market_place_datasets_12b05540_Part2.csv', category: 'part2' },
  { file: 'martket_place_datasets_8574d8ce_part3.csv', category: 'part3' },
];

/** Multi-label batch. Any flag of 1 means the row is a blocked example. */
const LABELED_FILE = { file: 'train.csv', text: 'comment_text' };
const LABELED_FLAGS = ['toxic', 'severe_toxic', 'obscene', 'threat', 'insult', 'identity_hate'] as const;

/** Batches added to the labeled set as blocked rows because they carry no label column. */
const LABELED_UNLABELLED_BATCHES: ReadonlyArray<{ file: string }> = [
  { file: 'market_place_datasets_12b05540_Part2.csv' },
  { file: 'martket_place_datasets_8574d8ce_part3.csv' },
];

/* ------------------------------------------------------------------ CSV read */

/**
 * Minimal RFC 4180 reader.
 *
 * Hand-rolled rather than pulled from npm because the batches contain quoted
 * fields with embedded newlines, and a naive split on the line would silently
 * change every row count in this file.
 */
function readCsv(file: string, firstLineIsHeader: boolean): { header: string[]; rows: string[][] } {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];

    if (quoted) {
      if (char === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === '') {
      quoted = true;
      started = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      started = true;
      continue;
    }
    if (char === '\r') continue;
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      started = false;
      continue;
    }
    field += char;
    started = true;
  }

  if (started || field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  /**
   * `firstLineIsHeader` is true only for the batch that genuinely carries column
   * names. The single-column term batches have none, so their first line is data
   * and is judged by `isStrayHeaderRow` instead of being silently eaten here.
   */
  const header = firstLineIsHeader ? (rows.shift() ?? []) : [];
  return { header, rows };
}

/** Lowercase, trim, and collapse every run of whitespace to one space. */
function normalizeTextKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when a single-column batch opens with a stray header row.
 *
 * Some of these batches were produced by concatenating exports, so the first line
 * of one of them is a captured CSV header rather than data. The test is generic on
 * purpose: the line must be first, must contain a comma, must have at least two
 * real fields, and every field must be empty or look like an identifier rather
 * than prose. Empty fields are allowed because that is exactly what a trailing
 * unnamed column produces, and it is what puts the comma at the start of the line.
 */
function isStrayHeaderRow(value: string): boolean {
  if (!value.includes(',')) return false;
  const fields = value.split(',');
  if (fields.filter((field) => field !== '').length < 2) return false;
  return fields.every((field) => field === '' || /^[A-Za-z_][A-Za-z0-9_]*$/.test(field));
}

/* --------------------------------------------------------------- term output */

interface TermEntry {
  term: string;
  category: string;
}

interface TermStats {
  category: string;
  rowsRead: number;
  blank: number;
  strayHeader: number;
  /** Rows whose term was already in the output, whether from this batch or an earlier one. */
  duplicates: number;
  kept: number;
}

interface TermBuild {
  entries: TermEntry[];
  stats: TermStats[];
  blank: number;
  strayHeader: number;
  duplicates: number;
  overTitleMax: number;
  overDescriptionMax: number;
}

function buildTerms(datasetsDir: string): TermBuild {
  const byTerm = new Map<string, string>();
  const stats: TermStats[] = [];
  let blank = 0;
  let strayHeader = 0;
  let duplicates = 0;
  let overTitleMax = 0;
  let overDescriptionMax = 0;

  for (const batch of TERM_BATCHES) {
    const file = path.join(datasetsDir, batch.file);
    const { rows } = readCsv(file, false);
    const counters: TermStats = {
      category: batch.category,
      rowsRead: rows.length,
      blank: 0,
      strayHeader: 0,
      duplicates: 0,
      kept: 0,
    };

    rows.forEach((row, index) => {
      const cell = (row[0] ?? '').replace(/\s+/g, ' ').trim();
      if (cell === '') {
        counters.blank += 1;
        blank += 1;
        return;
      }
      if (index === 0 && isStrayHeaderRow(cell)) {
        counters.strayHeader += 1;
        strayHeader += 1;
        return;
      }

      const key = normalizeTextKey(cell);
      if (byTerm.has(key)) {
        counters.duplicates += 1;
        duplicates += 1;
        return;
      }

      byTerm.set(key, batch.category);
      counters.kept += 1;
      if (cell.length > TITLE_MAX) overTitleMax += 1;
      if (cell.length > DESCRIPTION_MAX) overDescriptionMax += 1;
    });

    stats.push(counters);
  }

  const entries: TermEntry[] = [...byTerm.entries()]
    .map(([term, category]) => ({ term, category }))
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));

  return { entries, stats, blank, strayHeader, duplicates, overTitleMax, overDescriptionMax };
}

/* ------------------------------------------------------------- labeled output */

interface LabeledRow {
  text: string;
  label: 'blocked' | 'allowed';
  /**
   * Which input the row came from.
   *
   * `labeled_batch` rows carry an independent annotation. `term_batch` rows are the
   * single-column batches that also supply the terms, so a term always "matches"
   * its own source row. Counting those matches as evidence would let every term
   * vouch for itself, which is why term selection ignores them.
   */
  source: 'labeled_batch' | 'term_batch';
}

interface LabeledStats {
  rowsRead: number;
  blank: number;
  duplicates: number;
  crossLabel: number;
  keptBlocked: number;
  keptAllowed: number;
  overTitleMax: number;
  overDescriptionMax: number;
  labelCounts: Record<string, number>;
}

function buildLabeled(datasetsDir: string): { rows: LabeledRow[]; stats: LabeledStats } {
  /** Normalized text -> label and origin. A second label for the same text is a conflict. */
  const byText = new Map<
    string,
    { label: 'blocked' | 'allowed' | 'conflict'; source: LabeledRow['source'] }
  >();
  const labelCounts: Record<string, number> = {};
  const stats: LabeledStats = {
    rowsRead: 0,
    blank: 0,
    duplicates: 0,
    crossLabel: 0,
    keptBlocked: 0,
    keptAllowed: 0,
    overTitleMax: 0,
    overDescriptionMax: 0,
    labelCounts,
  };

  const offer = (text: string, label: 'blocked' | 'allowed', source: LabeledRow['source']): void => {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed === '') {
      stats.blank += 1;
      return;
    }
    stats.rowsRead += 1;
    if (trimmed.length > TITLE_MAX) stats.overTitleMax += 1;
    if (trimmed.length > DESCRIPTION_MAX) stats.overDescriptionMax += 1;

    const key = normalizeTextKey(trimmed);
    const existing = byText.get(key);
    if (existing === undefined) {
      byText.set(key, { label, source });
      return;
    }
    if (existing.label === 'conflict' || existing.label !== label) {
      // Present with both labels: undecidable, so it leaves the set entirely.
      if (existing.label !== 'conflict') stats.crossLabel += 1;
      byText.set(key, { label: 'conflict', source });
      return;
    }
    stats.duplicates += 1;
  };

  // The multi-label batch. Any flag of 1 makes the row a blocked example.
  const labeled = readCsv(path.join(datasetsDir, LABELED_FILE.file), true);
  const columnIndex = new Map(labeled.header.map((name, index) => [name, index]));
  const textIndex = columnIndex.get(LABELED_FILE.text) ?? 1;
  for (const flag of LABELED_FLAGS) {
    if (!columnIndex.has(flag)) throw new Error(`${LABELED_FILE.file} has no ${flag} column`);
  }
  const flagIndexes = LABELED_FLAGS.map((flag) => columnIndex.get(flag)!);

  for (const row of labeled.rows) {
    const flagged = flagIndexes.some((index) => (row[index] ?? '').trim() === '1');
    offer(row[textIndex] ?? '', flagged ? 'blocked' : 'allowed', 'labeled_batch');
  }

  // The single-column batches carry no label column. They ship with the blocked
  // word batches, so they enter the labeled set as blocked rows and nothing else.
  for (const batch of LABELED_UNLABELLED_BATCHES) {
    const { rows } = readCsv(path.join(datasetsDir, batch.file), false);
    rows.forEach((row, index) => {
      const cell = (row[0] ?? '').replace(/\s+/g, ' ').trim();
      if (cell === '' || (index === 0 && isStrayHeaderRow(cell))) return;
      offer(cell, 'blocked', 'term_batch');
    });
  }

  const rows: LabeledRow[] = [];
  for (const [key, entry] of byText) {
    if (entry.label === 'conflict') continue;
    if (entry.label === 'blocked') stats.keptBlocked += 1;
    else stats.keptAllowed += 1;
    labelCounts[entry.label] = (labelCounts[entry.label] ?? 0) + 1;
    rows.push({ text: key, label: entry.label, source: entry.source });
  }

  return { rows, stats };
}

/* ------------------------------------------------------------ term selection */

interface SelectionStats {
  candidates: number;
  kept: number;
  droppedSeenInAllowed: number;
  droppedNeverSeenInBlocked: number;
  droppedTooLittleEvidence: number;
  selectionRows: number;
  holdoutRows: number;
  notScreened: number;
  ignoredSelfReferentialRows: number;
}

/**
 * Keeps only the candidates that block blocked rows and never touch an allowed one.
 *
 * The rule is deliberately the strictest one that still adds recall. A term that
 * occurs anywhere in a row labeled allowed is ordinary wording as far as this
 * corpus can tell, and blocking a listing because it contains ordinary wording is
 * the one failure a marketplace cannot afford: it takes a real seller's listing
 * down. Being strict costs some recall, and the cost is measured and reported by
 * scripts/measure-screener.ts rather than assumed away.
 *
 * Two things are kept out of the evidence on purpose:
 *
 *   - the held-back split, so the measurement can score the result on rows the
 *     term list was not chosen from;
 *   - the rows that came from the term batches, because a term always matches its
 *     own source row and would otherwise be allowed to vouch for itself.
 */
function selectTerms(candidates: TermEntry[], rows: LabeledRow[]): { entries: TermEntry[]; stats: SelectionStats } {
  const compiled = candidates.map((entry) => compileWord(entry.term));
  const index = buildTermIndex(compiled);
  const termId = new Map<string, number>();
  compiled.forEach((term, id) => termId.set(term.spaced, id));

  const blockedHits = new Int32Array(compiled.length);
  const allowedHits = new Int32Array(compiled.length);
  const stats: SelectionStats = {
    candidates: candidates.length,
    kept: 0,
    droppedSeenInAllowed: 0,
    droppedNeverSeenInBlocked: 0,
    droppedTooLittleEvidence: 0,
    selectionRows: 0,
    holdoutRows: 0,
    notScreened: 0,
    ignoredSelfReferentialRows: 0,
  };

  rows.forEach((row, position) => {
    // Four of every five rows choose the terms. The fifth is held back so the
    // measurement can score the term list on rows it was not chosen from.
    if (position % HOLDOUT_EVERY === 0) {
      stats.holdoutRows += 1;
      return;
    }
    if (row.source === 'term_batch') {
      stats.ignoredSelfReferentialRows += 1;
      return;
    }
    stats.selectionRows += 1;

    if (row.text.length > DESCRIPTION_MAX) {
      // A listing this long could not be stored, so the screener never sees it
      // and it says nothing about whether a term is safe.
      stats.notScreened += 1;
      return;
    }

    const seen = new Set<number>();
    for (const term of indexMatches(toTarget(row.text), index)) {
      const id = termId.get(term.spaced);
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      if (row.label === 'blocked') blockedHits[id] += 1;
      else allowedHits[id] += 1;
    }
  });

  const entries: TermEntry[] = [];
  compiled.forEach((term, id) => {
    if (blockedHits[id] >= MIN_BLOCKED_HITS && allowedHits[id] === 0) {
      entries.push(candidates[id]);
      stats.kept += 1;
      return;
    }
    if (allowedHits[id] > 0) stats.droppedSeenInAllowed += 1;
    else if (blockedHits[id] > 0) stats.droppedTooLittleEvidence += 1;
    else stats.droppedNeverSeenInBlocked += 1;
  });

  return { entries, stats };
}

/* ----------------------------------------------------------------------- main */

function main(): void {
  const datasetsDir = process.env.MARKETPLACE_DATASETS_DIR
    ? path.resolve(process.env.MARKETPLACE_DATASETS_DIR)
    : DEFAULT_DATASETS_DIR;

  if (!fs.existsSync(datasetsDir)) {
    throw new Error(`dataset folder not found: ${datasetsDir}`);
  }

  const candidates = buildTerms(datasetsDir);
  const labeled = buildLabeled(datasetsDir);
  const selected = selectTerms(candidates.entries, labeled.rows);

  const termsPath = path.join(REPO_ROOT, 'src', 'moderation', 'data', 'blocked_terms.json');
  fs.mkdirSync(path.dirname(termsPath), { recursive: true });
  fs.writeFileSync(
    termsPath,
    `${JSON.stringify(
      {
        schema_version: TERMS_SCHEMA_VERSION,
        generator: 'scripts/build-moderation-data.ts',
        note: 'Generated output. Do not edit by hand; rerun the generator instead.',
        source_dir: path.basename(datasetsDir),
        selection: {
          method:
            `at_least_${MIN_BLOCKED_HITS}_independently_labeled_blocked_rows_and_never_an_allowed_row`,
          selection_split: `${HOLDOUT_EVERY - 1} of every ${HOLDOUT_EVERY} rows by position, the rest held back`,
          evidence_rows: 'only rows from the labeled batch, never the rows that supplied the terms',
          min_blocked_hits: MIN_BLOCKED_HITS,
          selection_rows: selected.stats.selectionRows,
          holdout_rows: selected.stats.holdoutRows,
          ignored_self_referential_rows: selected.stats.ignoredSelfReferentialRows,
          rows_too_long_to_screen: selected.stats.notScreened,
          candidates: selected.stats.candidates,
          kept: selected.stats.kept,
          dropped_seen_in_an_allowed_row: selected.stats.droppedSeenInAllowed,
          dropped_below_min_blocked_hits: selected.stats.droppedTooLittleEvidence,
          dropped_never_seen_in_a_blocked_row: selected.stats.droppedNeverSeenInBlocked,
        },
        term_count: selected.entries.length,
        terms: selected.entries,
      },
      null,
      0,
    )}\n`,
    'utf8',
  );

  const labeledPath = path.join(REPO_ROOT, 'data', 'labeled_listings.jsonl');
  fs.mkdirSync(path.dirname(labeledPath), { recursive: true });
  fs.writeFileSync(
    labeledPath,
    labeled.rows.length > 0 ? `${labeled.rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '',
    'utf8',
  );

  // The unfiltered list, kept so scripts/analyze-term-selection.ts can repeat the
  // study that chose the rule above without reading the raw batches again.
  const candidatesPath = path.join(REPO_ROOT, 'data', 'blocked_terms_candidates.json');
  fs.writeFileSync(
    candidatesPath,
    `${JSON.stringify({ schema_version: TERMS_SCHEMA_VERSION, candidates: candidates.entries.length, terms: candidates.entries }, null, 0)}\n`,
    'utf8',
  );

  /* Report. Counts and identifiers only, never a term or a listing body. */
  for (const stat of candidates.stats) {
    console.log(
      `terms batch=${stat.category} rows_read=${stat.rowsRead} blank=${stat.blank} ` +
        `stray_header=${stat.strayHeader} duplicate=${stat.duplicates} kept=${stat.kept}`,
    );
  }
  console.log(`terms candidates_total=${candidates.entries.length}`);
  console.log(`terms dropped_duplicate_total=${candidates.duplicates}`);
  console.log(
    `terms dropped_blank_total=${candidates.blank} dropped_stray_header_total=${candidates.strayHeader}`,
  );
  console.log(
    `terms candidates_over_title_max_100=${candidates.overTitleMax} ` +
      `over_description_max_2000=${candidates.overDescriptionMax}`,
  );
  console.log(
    `selection kept=${selected.stats.kept} dropped_seen_in_an_allowed_row=${selected.stats.droppedSeenInAllowed} ` +
      `dropped_below_min_blocked_hits=${selected.stats.droppedTooLittleEvidence} dropped_never_seen_in_a_blocked_row=${selected.stats.droppedNeverSeenInBlocked}`,
  );
  console.log(
    `selection rows_used=${selected.stats.selectionRows} rows_held_back=${selected.stats.holdoutRows} ` +
      `rows_too_long_to_screen=${selected.stats.notScreened}`,
  );
  const categories = new Map<string, number>();
  for (const entry of selected.entries) {
    categories.set(entry.category, (categories.get(entry.category) ?? 0) + 1);
  }
  console.log(
    `terms kept_by_category=${[...categories.entries()].map(([key, count]) => `${key}:${count}`).join(' ')}`,
  );
  console.log(
    `labeled rows_read=${labeled.stats.rowsRead} blank=${labeled.stats.blank} ` +
      `duplicate=${labeled.stats.duplicates} cross_label_dropped=${labeled.stats.crossLabel}`,
  );
  console.log(`labeled kept_blocked=${labeled.stats.keptBlocked} kept_allowed=${labeled.stats.keptAllowed}`);
  console.log(
    `labeled over_title_max_100=${labeled.stats.overTitleMax} over_description_max_2000=${labeled.stats.overDescriptionMax}`,
  );
  console.log(
    `wrote terms=${path.relative(REPO_ROOT, termsPath)} labeled=${path.relative(REPO_ROOT, labeledPath)} ` +
      `candidates=${path.relative(REPO_ROOT, candidatesPath)}`,
  );
  console.log(
    `summary terms_kept=${selected.entries.length} labeled_kept=${labeled.stats.keptBlocked + labeled.stats.keptAllowed}`,
  );
}

main();
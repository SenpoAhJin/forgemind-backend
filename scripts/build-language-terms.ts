/**
 * Builds src/moderation/data/blocked_terms_{en,tl}.json from the datasets.
 *
 * Run with: npx tsx scripts/build-language-terms.ts
 *
 * WHAT IT DOES
 * Two passes over the labeled corpora. Pass one counts how often a candidate
 * word or two-word phrase occurs in rows the corpus calls non-clean; pass two
 * counts the same candidates in rows the corpus calls clean. A candidate ships
 * only when it was seen repeatedly on the non-clean side and never once on the
 * clean side. That second half is the clean-word allowlist: place names, cosplay
 * terms, prop words and ordinary Tagalog words survive because a word that
 * appears in an innocent row has no business blocking a real seller's listing.
 *
 * WHOLE WORDS ONLY
 * Candidates are taken from the normalizer's own word split, so a candidate is
 * already the same shape the matcher will compare against. Nothing here does
 * substring counting, which is what would let the letters inside an ordinary
 * word become a rule.
 *
 * TWO OUTPUT FILES, TWO LANGUAGES
 * A candidate goes to the Tagalog file when most of its non-clean evidence came
 * from Tagalog or Taglish rows, and to the English file otherwise. Existing
 * curated rows in the Tagalog file are read back first and preserved, so the
 * hand-written Tagalog and Taglish vocabulary is never overwritten by a run.
 *
 * NOTHING SENSITIVE IS EVER PRINTED
 * Counts, rates, class names and file paths only. A term, a listing title or a
 * comment body is data the screener exists to keep out of the marketplace, so it
 * must not end up in a terminal scrollback, a CI log or a commit message.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildTermIndex,
  compileWord,
  containsTerm,
  indexMatches,
  normalizeText,
  toTarget,
  toWords,
  type CompiledWord,
} from '../src/moderation/normalize';
import { ALLOWLIST } from '../src/moderation/rules/allowlist';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATASETS = join(ROOT, '..', 'forgemind-ai', 'marketplace_datasets');

const OUT_EN = join(ROOT, 'src', 'moderation', 'data', 'blocked_terms_en.json');
const OUT_TL = join(ROOT, 'src', 'moderation', 'data', 'blocked_terms_tl.json');

/** Schema version of both output files. Bumped when the shape changes. */
const SCHEMA_VERSION = 1;

/** Non-clean hits a candidate needs before it is worth counting on clean rows. */
const MIN_NON_CLEAN_HITS = 5;

/**
 * Every HOLDOUT_EVERY rows are held back from selection so the measurement can
 * score the shipped list on rows the list was not chosen from.
 */
const HOLDOUT_EVERY = 5;

/** Clean rows a word must appear in before it joins the clean-word allowlist. */
const ALLOWLIST_MIN_CLEAN_HITS = 200;

/** Upper bound on allowlist size, so the rescue layer stays reviewable. */
const ALLOWLIST_MAX = 400;

/** Candidates above this many non-clean hits are dropped as too common to judge. */
const MAX_NON_CLEAN_HITS = 5000;

/* ------------------------------------------------------------------ inputs */

/** The class columns of the processed split, in the order they decide a row. */
const CLASS_FLAGS = ['adult', 'prohibited', 'unrelated', 'vulgar', 'hate'] as const;
type RowClass = 'clean' | (typeof CLASS_FLAGS)[number] | 'blocked';

interface Row {
  text: string;
  cls: RowClass;
  lang: 'en' | 'tl';
  /** False for rows held back from selection, used only for measurement. */
  selected: boolean;
}

/* ------------------------------------------------------------ language */

/**
 * Counts marker words to sort a row into an English-looking or a
 * Tagalog-looking bucket. Taglish rows carry both, and are folded into the
 * Tagalog bucket because that is the coverage this task is adding.
 *
 * This decides which file a term is filed under. It never decides whether a
 * listing is blocked: both files are loaded and matched against every listing,
 * so a mixed English and Tagalog listing is checked by both lists.
 */
const TL_MARKERS = new Set([
  'ang', 'ng', 'mga', 'ako', 'ikaw', 'kami', 'tayo', 'sila', 'ito', 'iyon', 'iyong', 'siya',
  'para', 'kasi', 'kaya', 'naman', 'lang', 'din', 'rin', 'ba', 'na', 'san', 'hindi', 'wala',
  'may', 'meron', 'ginawa', 'ginawang', 'bibili', 'gagawin', 'pwede', 'puwede', 'kailangan',
  'gusto', 'ayaw', 'bakit', 'saan', 'ano', 'sino', 'ilan', 'kano', 'paano', 'kapag', 'kung',
  'habang', 'bago', 'pagkatapos', 'tungkol', 'napaka', 'sobrang', 'mabuti', 'ganda', 'mahal',
  'kupon', 'benta', 'preset', 'gagamitin', 'pamasko',
]);
const EN_MARKERS = new Set([
  'the', 'and', 'with', 'for', 'from', 'your', 'you', 'are', 'this', 'that', 'have', 'sell',
  'selling', 'price', 'listing', 'shipping', 'available', 'condition', 'custom', 'made', 'size',
  'new', 'used', 'worn', 'complete', 'ready', 'order', 'meeting', 'meetup', 'item',
]);

export function languageOf(text: string): 'en' | 'tl' {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  let tl = 0;
  let en = 0;
  for (const word of words) {
    if (TL_MARKERS.has(word)) tl += 1;
    if (EN_MARKERS.has(word)) en += 1;
  }
  // A single Tagalog marker in an English sentence is normal Taglish grammar,
  // not evidence that the whole row belongs to the Tagalog file.
  if (tl >= 2 && tl > en) return 'tl';
  if (tl >= 1 && en >= 1) return 'tl';
  return 'en';
}

/* ------------------------------------------------------------- csv read */

/**
 * Minimal RFC 4180 reader for the processed split.
 *
 * Hand-rolled because the batches contain quoted fields with embedded commas and
 * newlines, and a naive split on the line silently changes every row count.
 */
export function readCsv(file: string): { header: string[]; rows: string[][] } {
  const raw = readFileSync(file, 'utf8').replace(/^﻿/, '');
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
        } else quoted = false;
      } else field += char;
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

  const header = rows.shift() ?? [];
  return { header, rows };
}

/* ------------------------------------------------------------ corpus read */

/** Splits a row's text into the words and word pairs the matcher compares. */
export function tokensOf(text: string): string[] {
  const words = toWords(normalizeText(text).spaced).filter((word) => word.length >= 3);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    out.push(words[i]);
    if (i + 1 < words.length) out.push(`${words[i]} ${words[i + 1]}`);
  }
  return out;
}

/**
 * Reads one processed split.
 *
 * `forceHeldOut` is set for the test split: it is never allowed to choose a
 * term, so every row it contributes is counted as held back and the measurement
 * scores the shipped list on rows the list was not built from.
 */
export function readProcessed(file: string, forceHeldOut = false): Row[] {
  if (!existsSync(file)) return [];
  const { header, rows } = readCsv(file);
  const column = new Map(header.map((name, index) => [name, index]));
  const textIndex = column.get('text') ?? 1;
  const flagIndexes = CLASS_FLAGS.map((name) => column.get(name) ?? -1);

  const out: Row[] = [];
  rows.forEach((row, index) => {
    const text = row[textIndex] ?? '';
    if (text.trim() === '') return;
    let cls: RowClass = 'clean';
    for (let i = 0; i < flagIndexes.length; i += 1) {
      const cell = flagIndexes[i] >= 0 ? (row[flagIndexes[i]] ?? '') : '';
      if (cell.trim() === '1') {
        cls = CLASS_FLAGS[i];
        break;
      }
    }
    out.push({
      text,
      cls,
      lang: languageOf(text),
      selected: forceHeldOut ? false : index % HOLDOUT_EVERY !== 0,
    });
  });
  return out;
}

export function readLabeled(file: string): Row[] {
  if (!existsSync(file)) return [];
  const out: Row[] = [];
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    let parsed: { text?: string; label?: string };
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const text = parsed.text ?? '';
    if (text.trim() === '') return;
    out.push({
      text,
      cls: parsed.label === 'allowed' ? 'clean' : 'blocked',
      lang: languageOf(text),
      selected: index % HOLDOUT_EVERY !== 0,
    });
  });
  return out;
}

/* --------------------------------------------------------------- mining */

interface Candidate {
  term: string;
  nonCleanHits: number;
  cleanHits: number;
  classHits: Record<string, number>;
  langHits: Record<string, number>;
}

interface MiningStats {
  rowsNonClean: number;
  rowsClean: number;
  tokensNonClean: number;
  candidatesAfterMinHits: number;
  droppedTooCommon: number;
  droppedSeenClean: number;
  droppedTooLittleEvidence: number;
  kept: number;
  keptByClass: Record<string, number>;
  keptByLanguage: Record<string, number>;
  allowlistWords: number;
  /** Every token seen in a clean row, so a generated variant can be refused. */
  cleanVocab: Set<string>;
  /** The clean-word allowlist derived from clean rows. */
  allowlist: string[];
  heldOutRows: number;
  selectionRows: number;
}

function mine(rows: Row[]): { candidates: Candidate[]; stats: MiningStats } {
  const stats: MiningStats = {
    rowsNonClean: 0,
    rowsClean: 0,
    tokensNonClean: 0,
    candidatesAfterMinHits: 0,
    droppedTooCommon: 0,
    droppedSeenClean: 0,
    droppedTooLittleEvidence: 0,
    kept: 0,
    keptByClass: {},
    keptByLanguage: {},
    allowlistWords: 0,
    cleanVocab: new Set<string>(),
    allowlist: [],
    heldOutRows: 0,
    selectionRows: 0,
  };

  const map = new Map<string, Candidate>();
  const cleanFreq = new Map<string, number>();

  // Pass one: non-clean rows in the selection split only. Held-back rows are
  // counted below so the report can say how much was held back, but they never
  // choose a term, or the measurement would score the list on rows it was
  // selected from.
  for (const row of rows) {
    if (row.selected) stats.selectionRows += 1;
    else stats.heldOutRows += 1;
    if (row.cls === 'clean' || !row.selected) continue;
    stats.rowsNonClean += 1;
    for (const token of tokensOf(row.text)) {
      let candidate = map.get(token);
      if (!candidate) {
        candidate = {
          term: token,
          nonCleanHits: 0,
          cleanHits: 0,
          classHits: {},
          langHits: {},
        };
        map.set(token, candidate);
      }
      candidate.nonCleanHits += 1;
      candidate.classHits[row.cls] = (candidate.classHits[row.cls] ?? 0) + 1;
      candidate.langHits[row.lang] = (candidate.langHits[row.lang] ?? 0) + 1;
      stats.tokensNonClean += 1;
    }
  }

  // Second thought: a term seen thousands of times on the non-clean side is
  // common language, not a blocklist entry, and judging it would only cost
  // recall that the curated rules already cover.
  for (const [token, candidate] of map) {
    if (candidate.nonCleanHits < MIN_NON_CLEAN_HITS) {
      map.delete(token);
      stats.droppedTooLittleEvidence += 1;
    } else if (candidate.nonCleanHits > MAX_NON_CLEAN_HITS) {
      map.delete(token);
      stats.droppedTooCommon += 1;
    }
  }
  stats.candidatesAfterMinHits = map.size;

  // Pass two: clean rows in the selection split, counting only the surviving
  // candidates. This is the large side, so the lookup is a single map hit per
  // token. Held-back clean rows stay out of it and are what the false-block
  // rate is measured on later.
  for (const row of rows) {
    if (row.cls !== 'clean' || !row.selected) continue;
    stats.rowsClean += 1;
    for (const token of tokensOf(row.text)) {
      const candidate = map.get(token);
      if (candidate) candidate.cleanHits += 1;
      if (token.length >= 4 && !token.includes(' ')) {
        cleanFreq.set(token, (cleanFreq.get(token) ?? 0) + 1);
      }
    }
  }

  const kept: Candidate[] = [];
  for (const candidate of map.values()) {
    // The whole point: never ship a word an innocent row contains.
    if (candidate.cleanHits > 0) {
      stats.droppedSeenClean += 1;
      continue;
    }
    kept.push(candidate);
    stats.kept += 1;
    const cls = dominant(candidate.classHits);
    candidate.term = candidate.term;
    stats.keptByClass[cls] = (stats.keptByClass[cls] ?? 0) + 1;
    const lang = dominant(candidate.langHits);
    stats.keptByLanguage[lang] = (stats.keptByLanguage[lang] ?? 0) + 1;
  }

  // The clean-word allowlist: words frequent enough in clean rows to be ordinary
  // language, kept so a term that happens to sit inside one of them can be
  // rescued at match time rather than blocking the word.
  const allowlist = [...cleanFreq.entries()]
    .filter(([, hits]) => hits >= ALLOWLIST_MIN_CLEAN_HITS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, ALLOWLIST_MAX)
    .map(([word]) => word);
  stats.allowlistWords = allowlist.length;
  stats.allowlist = allowlist;
  stats.cleanVocab = new Set(cleanFreq.keys());

  return { candidates: kept, stats };
}

/** The key with the highest count, or the lexicographic winner on a tie. */
function dominant(counts: Record<string, number>): string {
  let best = '';
  let bestHits = -1;
  for (const key of Object.keys(counts).sort()) {
    if (counts[key] > bestHits) {
      best = key;
      bestHits = counts[key];
    }
  }
  return best;
}

/* ---------------------------------------------------------------- output */

interface TermRow {
  term: string;
  class: string;
  source: string;
}

interface TermFile {
  schema_version: number;
  language: string;
  generator: string;
  note: string;
  selection: Record<string, unknown>;
  term_count: number;
  allowlist_count: number;
  allowlist: string[];
  terms: TermRow[];
}

function readCurated(file: string): TermRow[] {
  if (!existsSync(file)) return [];
  try {
    // A leading byte-order mark would make the parse fail and silently drop every
    // hand-written row, so it is stripped before the text reaches the parser.
    const parsed = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Partial<TermFile>;
    return Array.isArray(parsed.terms)
      ? parsed.terms.filter((row) => row && row.source === 'curated' && typeof row.term === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Letter-swap spellings of a term, in each direction separately.
 *
 * A writer who means `c` but reaches for `k` produces one transformation of the
 * term, and a writer who means `k` but reaches for `c` produces the other. They
 * are generated apart on purpose: applying both swaps in sequence would feed the
 * second replacement the letters the first one just wrote and produce a form
 * nobody typed.
 *
 * Nothing else is generated here. Case folding, homoglyph folding, symbol and
 * number substitution, inserted separators and repeated letters are all undone
 * by normalize.ts on the listing side, so those spellings need no term variant.
 */
function spellVariants(term: string): string[] {
  if (term.includes(' ') || term.length < 4) return [];
  const cToK = term.replace(/c/g, 'k');
  const kToC = term.replace(/k/g, 'c');
  const out: string[] = [];
  if (cToK !== term) out.push(cToK);
  if (kToC !== term) out.push(kToC);
  return out;
}

function buildFile(
  language: string,
  curated: TermRow[],
  mined: Candidate[],
  allowlist: string[],
  /** Every token seen in a clean row, used to refuse a variant that would. */
  cleanVocab: Set<string>,
  stats: MiningStats,
): TermFile {
  const byTerm = new Map<string, TermRow>();

  /** Adds a spelling variant, unless a clean row already contains it. */
  const addVariant = (term: string, cls: string): void => {
    for (const variant of spellVariants(term)) {
      if (byTerm.has(variant)) continue;
      if (cleanVocab.has(variant)) continue;
      byTerm.set(variant, { term: variant, class: cls, source: 'variant' });
    }
  };

  for (const row of curated) {
    byTerm.set(row.term, row);
    addVariant(row.term, row.class);
  }

  for (const candidate of mined) {
    const cls = dominant(candidate.classHits);
    // A hand-reviewed row wins a collision with a mined one: the curated list is
    // the one a moderator signed off on, and it may carry a different class.
    if (byTerm.has(candidate.term)) continue;
    byTerm.set(candidate.term, { term: candidate.term, class: cls, source: 'dataset' });
    addVariant(candidate.term, cls);
  }

  const terms = [...byTerm.values()].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
  const byClass: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  for (const row of terms) {
    byClass[row.class] = (byClass[row.class] ?? 0) + 1;
    bySource[row.source] = (bySource[row.source] ?? 0) + 1;
  }

  return {
    schema_version: SCHEMA_VERSION,
    language,
    generator: 'scripts/build-language-terms.ts',
    note: 'Generated output. Do not edit by hand; rerun the generator instead.',
    selection: {
      method: `at_least_${MIN_NON_CLEAN_HITS}_non_clean_hits_and_zero_clean_hits`,
      selection_split: `${HOLDOUT_EVERY - 1} of every ${HOLDOUT_EVERY} rows by position, the rest held back`,
      non_clean_rows: stats.rowsNonClean,
      clean_rows: stats.rowsClean,
      candidates_after_min_hits: stats.candidatesAfterMinHits,
      dropped_seen_in_a_clean_row: stats.droppedSeenClean,
      dropped_too_common_to_judge: stats.droppedTooCommon,
      dropped_below_min_non_clean_hits: stats.droppedTooLittleEvidence,
      kept: stats.kept,
      kept_by_class: stats.keptByClass,
      kept_by_detected_language: stats.keptByLanguage,
      allowlist_min_clean_hits: ALLOWLIST_MIN_CLEAN_HITS,
      allowlist_words: stats.allowlistWords,
      rows_held_back: stats.heldOutRows,
      rows_used_for_selection: stats.selectionRows,
      count_by_class: byClass,
      count_by_source: bySource,
    },
    term_count: terms.length,
    allowlist_count: allowlist.length,
    allowlist,
    terms,
  };
}

/* ------------------------------------------------------------ verification */

/**
 * Removes every generated term the shipped matcher fires on in a clean row.
 *
 * WHY THE MINER IS NOT ENOUGH
 * The miner counts a term by exact token, but the matcher also compares a
 * squash-folded form of each word, so a term whose repeated letters collapse
 * can land on an ordinary clean word that never contained the term as a token.
 * That collision is invisible to token counting and is the reason a list built
 * on zero clean hits still blocked clean rows: a handful of fold-colliding
 * terms produced nearly every false hit.
 *
 * WHY THIS USES THE REAL MATCHER
 * Rather than reimplementing the fold, this pass calls `indexMatches` — the
 * same lookup `moderateListing` calls — over a compiled index of the files being
 * built, and applies the same allowlist rescue. Whatever fires here would have
 * fired on a live listing, so nothing is dropped that would not have blocked,
 * and nothing is kept that would.
 *
 * ONLY GENERATED TERMS ARE DROPPED
 * Rows a moderator wrote by hand are left alone. A curated word that appears in
 * a corpus row is a judgement call that was already made; the generated lists
 * carry no such sign-off, so they get the stricter rule.
 *
 * SELECTION ROWS ONLY
 * Held-back clean rows are the set the false-block rate is measured on, so this
 * pass never looks at them.
 */
function pruneAgainstCleanRows(
  files: TermFile[],
  cleanRows: Row[],
): { scanned: number; dropped: number; droppedBySource: Record<string, number> } {
  const compiled: CompiledWord[] = [];
  for (const file of files) {
    for (const row of file.terms) {
      if (row.source === 'curated') continue;
      const word = compileWord(row.term);
      if (word.spaced === '') continue;
      compiled.push(word);
    }
  }
  if (compiled.length === 0) return { scanned: 0, dropped: 0, droppedBySource: {} };

  const index = buildTermIndex(compiled);
  // Both rescues the endpoint applies: the curated allowlist and the one built
  // from these files. Mirroring only one would drop terms the endpoint would
  // have let through, trading recall away for no false-block benefit.
  const allow = [...new Set([...ALLOWLIST, ...files.flatMap((file) => file.allowlist)])]
    .map((word) => compileWord(word))
    .filter((word) => word.spaced !== '');

  /** The rescue the endpoint applies, mirrored exactly. */
  const rescued = (target: ReturnType<typeof toTarget>, term: CompiledWord): boolean => {
    if (term.spaced.length === 0) return false;
    return allow.some((entry) => {
      if (entry.spaced.length <= term.spaced.length) return false;
      if (!containsTerm(target, entry)) return false;
      return entry.spaced.includes(term.spaced) || entry.squashed.includes(term.squashed);
    });
  };

  const doomed = new Set<string>();
  let scanned = 0;
  for (const row of cleanRows) {
    if (row.cls !== 'clean' || !row.selected) continue;
    scanned += 1;
    const target = toTarget(row.text);
    for (const hit of indexMatches(target, index)) {
      if (doomed.has(hit.spaced)) continue;
      if (rescued(target, hit)) continue;
      doomed.add(hit.spaced);
    }
  }

  const droppedBySource: Record<string, number> = {};
  let dropped = 0;
  for (const file of files) {
    const next = file.terms.filter((row) => {
      if (row.source === 'curated') return true;
      const word = compileWord(row.term);
      if (!doomed.has(word.spaced)) return true;
      droppedBySource[row.source] = (droppedBySource[row.source] ?? 0) + 1;
      dropped += 1;
      return false;
    });
    file.terms = next;
    file.term_count = next.length;
    const byClass: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    for (const row of next) {
      byClass[row.class] = (byClass[row.class] ?? 0) + 1;
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
    }
    file.selection.count_by_class = byClass;
    file.selection.count_by_source = bySource;
  }
  for (const file of files) {
    file.selection.dropped_by_matcher_on_a_clean_row = dropped;
  }

  return { scanned, dropped, droppedBySource };
}

/* ------------------------------------------------------------------ main */

function main(): void {
  const processedTrain = join(DATASETS, 'processed', 'train.csv');
  const processedTest = join(DATASETS, 'processed', 'test.csv');
  const labeled = join(ROOT, 'data', 'labeled_listings.jsonl');

  const rows: Row[] = [
    ...readProcessed(processedTrain),
    ...readLabeled(labeled),
    // The test split is held out in full: it feeds the measurement, never the
    // selection, so scoring a term on it says something about the term.
    ...readProcessed(processedTest, true),
  ];

  const { candidates, stats } = mine(rows);

  const curatedTl = readCurated(OUT_TL);
  const curatedEn = readCurated(OUT_EN);
  // The clean-word allowlist is shared: it is built from clean rows whichever
  // language they were written in, and both files are matched against every
  // listing anyway.
  const allowlist = stats.allowlist;

  // Split the mined candidates by the language that supplied their evidence.
  const forTl = candidates.filter((c) => (c.langHits.tl ?? 0) > (c.langHits.en ?? 0));
  const forEn = candidates.filter((c) => (c.langHits.tl ?? 0) <= (c.langHits.en ?? 0));

  const fileTl = buildFile('tl', curatedTl, forTl, allowlist, stats.cleanVocab, {
    ...stats,
    kept: forTl.length,
    keptByClass: countByClass(forTl),
    keptByLanguage: countByLang(forTl),
  });
  const fileEn = buildFile('en', curatedEn, forEn, allowlist, stats.cleanVocab, {
    ...stats,
    kept: forEn.length,
    keptByClass: countByClass(forEn),
    keptByLanguage: countByLang(forEn),
  });

  // Verification runs after both files exist and before either is written: the
  // matcher indexes them together at runtime, so a term is only known safe once
  // it has survived clean rows checked against the combined index.
  const prune = pruneAgainstCleanRows([fileEn, fileTl], rows);

  writeFileSync(OUT_EN, `${JSON.stringify(fileEn, null, 0)}\n`, 'utf8');
  writeFileSync(OUT_TL, `${JSON.stringify(fileTl, null, 0)}\n`, 'utf8');

  /* Report. Counts and file names only, never a term or a listing body. */
  console.log(
    `corpus non_clean_rows=${stats.rowsNonClean} clean_rows=${stats.rowsClean} ` +
      `selection_rows=${stats.selectionRows} held_out_rows=${stats.heldOutRows}`,
  );
  console.log(
    `mine candidates_after_min_hits=${stats.candidatesAfterMinHits} ` +
      `dropped_below_min_hits=${stats.droppedTooLittleEvidence} ` +
      `dropped_too_common=${stats.droppedTooCommon} dropped_seen_in_clean=${stats.droppedSeenClean} ` +
      `kept_total=${stats.kept}`,
  );
  console.log(`mine kept_by_class=${formatCounts(stats.keptByClass)}`);
  console.log(`mine kept_by_detected_language=${formatCounts(stats.keptByLanguage)}`);
  console.log(
    `split en=${fileEn.term_count} (curated=${curatedEn.length} allowlist=${fileEn.allowlist_count}) ` +
      `tl=${fileTl.term_count} (curated=${curatedTl.length} allowlist=${fileTl.allowlist_count})`,
  );
  console.log(`split en_by_class=${formatCounts(fileEn.selection.count_by_class as Record<string, number>)}`);
  console.log(`split tl_by_class=${formatCounts(fileTl.selection.count_by_class as Record<string, number>)}`);
  console.log(
    `verify clean_selection_rows_scanned=${prune.scanned} dropped_by_matcher=${prune.dropped} ` +
      `by_source=${formatCounts(prune.droppedBySource)}`,
  );
  console.log(`verify en_terms=${fileEn.term_count} tl_terms=${fileTl.term_count}`);
  console.log(`wrote en=${rel(OUT_EN)} tl=${rel(OUT_TL)}`);
}

function countByClass(rows: Candidate[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const cls = dominant(row.classHits);
    out[cls] = (out[cls] ?? 0) + 1;
  }
  return out;
}

function countByLang(rows: Candidate[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const lang = dominant(row.langHits);
    out[lang] = (out[lang] ?? 0) + 1;
  }
  return out;
}

function formatCounts(counts: Record<string, number>): string {
  const parts = Object.entries(counts).map(([key, value]) => `${key}=${value}`);
  return parts.length > 0 ? parts.join(' ') : 'none';
}

function rel(file: string): string {
  return file.slice(ROOT.length + 1).replace(/\\/g, '/');
}

/**
 * Runs only when this file is the entry point.
 *
 * The corpus readers are exported for the measurement script, and importing them
 * must not regenerate the term files as a side effect.
 */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}

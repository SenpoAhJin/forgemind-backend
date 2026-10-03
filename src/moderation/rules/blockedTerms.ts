/**
 * The generated blocked-term list, loaded from data instead of hand-written here.
 *
 * WHY A DATA FILE
 * src/moderation/rules/*.ts holds the curated lists: the short, reviewable set of
 * words a moderator would agree with by reading them. That set cannot absorb a
 * corpus. The corpus lives in ../data/blocked_terms.json, compiled from the raw
 * marketplace_datasets batches by scripts/build-moderation-data.ts, and this file
 * is the only place that knows how to load it.
 *
 * WHY THE LIST IS FED TO THE EXISTING MATCHER
 * Nothing here matches anything. Every term goes through `compileWord`, which is
 * the same normalizer the hand-written lists use, so the case folding, the
 * homoglyph folding, the symbol mapping and the separator handling all still
 * apply to a generated term exactly as they apply to a reviewed one. The lookup
 * itself is `indexMatches`, which keeps whole-word matching for single words and
 * contiguous-phrase matching for multi-word terms. A generated term therefore
 * cannot be a bare substring hit, which is the failure mode that would let an
 * innocent listing get blocked over the letters inside an ordinary word.
 *
 * WHY EVERY EXPORT IS A FUNCTION
 * normalize.ts needs LIMITS from ./rules, so this module and normalize.ts sit on
 * either side of an import cycle. Compiling the list at module scope would run
 * before normalize.ts finishes initializing and would throw on the first use. The
 * list is therefore built once, on first use, and kept. The cost is paid by the
 * first screened listing rather than by every process that merely imports the
 * moderation barrel.
 *
 * THE FILE IS NEVER SERVED
 * Only counts and categories leave this module. The terms themselves are used for
 * matching and for offline measurement, never returned from an endpoint.
 *
 * A MISSING OR EMPTY FILE IS NOT A CRASH
 * The screener has to keep working if the generated data is absent, so an empty
 * list yields an empty index and the curated rules carry on alone.
 */

import { buildTermIndex, compileWord, type CompiledWord, type TermIndex } from '../normalize';
import termData from '../data/blocked_terms.json';

interface GeneratedTerm {
  term: string;
  category: string;
}

interface GeneratedTermFile {
  schema_version?: number;
  term_count?: number;
  terms?: GeneratedTerm[];
}

interface LoadedTerms {
  /** One compiled term per usable row, in file order. */
  terms: CompiledWord[];
  index: TermIndex;
  /** Normalized term -> the batch it arrived in. */
  category: Map<string, string>;
  /** Usable terms. The number tests and reports quote. */
  count: number;
  /** Rows the file held that cannot be matched, including the empty ones. */
  dropped: number;
  /** How many usable terms arrived from each batch. Keys are batch names. */
  countByCategory: Record<string, number>;
  /** Schema version of the generated file, or 0 when it predates versioning. */
  schemaVersion: number;
}

let cached: LoadedTerms | null = null;

function load(): LoadedTerms {
  if (cached) return cached;

  const data = termData as unknown as GeneratedTermFile;
  // The file is regenerated rather than hand-edited, so its rows are untrusted.
  const rows: GeneratedTerm[] = Array.isArray(data?.terms) ? data.terms : [];

  /**
   * Rows that survive normalization.
   *
   * A term made only of separators has no normalized form, so it can never match
   * anything. Counting it as a term would make the reported size a lie.
   */
  const usable = rows.filter((row) => typeof row?.term === 'string' && compileWord(row.term).spaced !== '');

  const terms = usable.map((row) => compileWord(row.term));
  const category = new Map<string, string>();
  const countByCategory: Record<string, number> = {};

  for (const row of usable) {
    const spaced = compileWord(row.term).spaced;
    const bucket = typeof row.category === 'string' && row.category !== '' ? row.category : 'uncategorized';
    category.set(spaced, row.category);
    countByCategory[bucket] = (countByCategory[bucket] ?? 0) + 1;
  }

  cached = {
    terms,
    index: buildTermIndex(terms),
    category,
    count: terms.length,
    dropped: rows.length - usable.length,
    countByCategory,
    schemaVersion: typeof data?.schema_version === 'number' ? data.schema_version : 0,
  };
  return cached;
}

/** The fast lookup shape. Built once, on first use. */
export function blockedTermIndex(): TermIndex {
  return load().index;
}

/** Usable terms. The number tests and reports quote. */
export function blockedTermCount(): number {
  return load().count;
}

/** Rows the file held that cannot be matched, so the reported size stays honest. */
export function blockedTermDroppedCount(): number {
  return load().dropped;
}

/** How many terms arrived from each batch. Keys are batch names, never terms. */
export function blockedTermCountByCategory(): Readonly<Record<string, number>> {
  return load().countByCategory;
}

/** Schema version of the generated file, or 0 when it predates versioning. */
export function blockedTermSchemaVersion(): number {
  return load().schemaVersion;
}

/**
 * The batch a normalized term arrived in.
 *
 * The batches carry no category column, so the batch each term was shipped in is
 * the only category information the data has. It is enough to tell a reviewer
 * which export a surprising term arrived with; it is not a content judgement.
 */
export function blockedTermCategory(spacedTerm: string): string | undefined {
  return load().category.get(spacedTerm);
}

/** Drops the memoized list. Only used by tests that need a cold build. */
export function resetBlockedTermCache(): void {
  cached = null;
}
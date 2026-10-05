/**
 * Text normalization for moderation matching.
 *
 * The goal is narrow: turn the ways people obfuscate a word into the same shape
 * as the plain word, without ever changing what a word *means*. Every function
 * here is pure and deterministic, which is what keeps the rule tests stable.
 *
 * Folding is applied to both the listing text and the rule term before any
 * comparison. Folding only one side is how a filter ends up blocking ordinary
 * words that happen to contain a double letter.
 */

import { LIMITS } from './rules';

/**
 * Runs of the same letter, three or more.
 *
 * Collapsed to a single letter. Real writing repeats a letter occasionally, but
 * padding a word out to four of the same letter is not something a person types
 * by accident, and the comparison is whole-word so folding cannot merge two
 * different words together.
 */
const COLLAPSE_REPEATS = /([a-z])\1+/g;

/** Anything that is not a lowercase letter or a number acts as a separator. */
const SEPARATORS = /[^a-z0-9]+/g;

/** Control characters and the zero-width family, which render as nothing. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;

/** Combining accents left behind by NFKD. */
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Cyrillic and Greek letters people reach for to dodge a text filter. */
const HOMOGLYPHS: Record<string, string> = {
  а: 'a', б: 'b', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o',
  р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h',
  α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ο: 'o', ρ: 'p', σ: 's', τ: 't',
  υ: 'u', χ: 'x', ν: 'v',
};

/**
 * Symbol-for-letter swaps.
 *
 * Only the unambiguous ones. Mapping a symbol that stands for several letters,
 * or a letter that stands for several symbols, would corrupt ordinary words.
 */
const SYMBOL_MAP: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'l',
};

/** Minimum folded length before a folded comparison is trusted. */
export const SQUASH_MIN = 4;

/**
 * Two searchable forms of one input string.
 *
 * - `spaced`: accents folded, homoglyphs folded, symbols mapped, every other
 *   non-alphanumeric run collapsed to a single space. Repeated letters left
 *   alone. This is the form the word split runs on.
 * - `squashed`: `spaced` with all separators removed and repeated letters
 *   collapsed. Catches the same word written as "f.u.c.k" or "fuccckk".
 */
export interface NormalizedText {
  spaced: string;
  squashed: string;
}

/** A rule term held in both comparable shapes, computed once at startup. */
export interface CompiledWord {
  spaced: string;
  squashed: string;
}

export function normalizeText(input: string): NormalizedText {
  if (typeof input !== 'string' || input.length === 0) {
    return { spaced: '', squashed: '' };
  }

  const lowered = input.toLowerCase();
  const withoutInvisible = lowered.replace(INVISIBLE, '');
  const homoglyphFolded = withoutInvisible.replace(
    /[\u0400-\u04ff\u0370-\u03ff]/g,
    (char) => HOMOGLYPHS[char] ?? ' ',
  );
  const decomposed = homoglyphFolded.normalize('NFKD').replace(COMBINING_MARKS, '');
  const symbolMapped = decomposed.replace(/[013457@$!|]/g, (char) => SYMBOL_MAP[char] ?? char);

  const spaced = symbolMapped.replace(SEPARATORS, ' ').trim();
  const squashed = symbolMapped.replace(SEPARATORS, '').replace(COLLAPSE_REPEATS, '$1');

  return { spaced, squashed };
}

/** Prepares a rule term for matching. Called once per term at startup. */
export function compileWord(term: string): CompiledWord {
  const normalized = normalizeText(term);
  return { spaced: normalized.spaced, squashed: normalized.squashed };
}

/**
 * Splits normalized text into words, merging runs of single characters.
 *
 * "f u c k quality" becomes ["fuck", "quality"] and "d.a.m.n cheap" becomes
 * ["damn", "cheap"], which is what makes the separator bypasses arrive at the
 * matcher as a real word instead of four one-letter tokens.
 */
export function toWords(spaced: string): string[] {
  const tokens = spaced.split(' ').filter((token) => token.length > 0);
  const words: string[] = [];
  let run = '';

  for (const token of tokens) {
    if (token.length === 1) {
      run += token;
      continue;
    }
    if (run.length > 0) {
      words.push(run);
      run = '';
    }
    words.push(token);
  }
  if (run.length > 0) words.push(run);

  return words;
}

/** Folds a single word the same way `squashed` folds a whole string. */
function squashWord(word: string): string {
  return word.replace(COLLAPSE_REPEATS, '$1');
}

/**
 * Everything the matcher needs about one field of text, computed once.
 *
 * `words` drives whole-word matching and `spaced` drives phrase matching. A
 * phrase rule such as a two-word item type cannot be expressed as a single word,
 * so it is matched as a contiguous run of words in the normalized text.
 */
export interface MatchTarget {
  words: string[];
  spaced: string;
}

/** Normalizes one field and splits it for matching. */
export function toTarget(input: string): MatchTarget {
  const normalized = normalizeText(input);
  return { words: toWords(normalized.spaced), spaced: normalized.spaced };
}

/** Normalizes several fields as one body, for relevance that spans both. */
export function toCombinedTarget(...parts: string[]): MatchTarget {
  const normalized = normalizeText(parts.filter((part) => part.length > 0).join(' '));
  return { words: toWords(normalized.spaced), spaced: normalized.spaced };
}

/**
 * True when `target` contains `term`.
 *
 * A multi-word term has to appear as a contiguous phrase: matching each word
 * separately would let "fake" in one sentence and "id" three paragraphs later
 * read as a hit.
 *
 * A single-word term matches only a whole word, never a bare substring.
 * Substring matching is what makes a keyword filter block an ordinary word over
 * the letters inside it, and it is the single largest source of false positives
 * in filters like this. Each word is then compared folded as well, which catches
 * "fuuuck" without folding only the text and leaving the term untouched.
 */
export function containsTerm(target: MatchTarget, term: CompiledWord): boolean {
  if (term.spaced.length === 0) return false;

  if (term.spaced.includes(' ')) {
    // Only a contiguous phrase counts, and only on word boundaries. Comparing the
    // phrase against the whole spaced field as a raw substring would let "foo bar"
    // match inside "xfoo bar", which is one short qualifier away from matching a
    // phrase that is not there at all.
    return phraseOccurs(target.spaced, term.spaced);
  }

  for (const word of target.words) {
    if (word === term.spaced) return true;
    if (term.squashed.length >= SQUASH_MIN && squashWord(word) === term.squashed) return true;
  }
  return false;
}

/**
 * Shortest fragment allowed inside a glued run.
 *
 * A space inserted inside a word has to be undone before a phrase can match, but
 * only when every piece it produced still looks like a piece somebody meant to
 * hide. One and two letter fragments are where ordinary word boundaries land —
 * "pen is", "an alysis" — so a run containing one of those is real writing with
 * a space in a natural place, not an obfuscated word, and is left alone.
 */
const MIN_GLUE_FRAGMENT = 3;

/** Shortest word a glued run may produce, before it counts as the hidden word. */
const MIN_GLUE_WORD = 5;

/**
 * True when `phrase` appears in `spaced` starting at a word boundary and ending
 * at a word boundary. Both strings are single-space separated by construction.
 *
 * A phrase word may also be spread across two or more adjacent words, which is
 * what an inserted space inside a term looks like once the text is normalized.
 * The run is accepted only when it reassembles the phrase word exactly: every
 * fragment clears `MIN_GLUE_FRAGMENT` and the whole clears `MIN_GLUE_WORD`, so
 * "gun" glued from "gu" and "n" is refused while a word split down its middle
 * is caught. Greedy is exact here rather than a guess — the fragments are
 * appended only while the run is still shorter than the phrase word, so it stops
 * the moment the letters line up and cannot overshoot and try again.
 */
function phraseOccurs(spaced: string, phrase: string): boolean {
  const words = spaced.split(' ');
  const wanted = phrase.split(' ');
  if (wanted.length > words.length) return false;

  for (let start = 0; start + wanted.length <= words.length; start += 1) {
    let cursor = start;
    let matched = true;
    for (const word of wanted) {
      const next = glueForward(words, cursor, word);
      if (next < 0) {
        matched = false;
        break;
      }
      cursor = next;
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Consumes words from `from` until they spell `word`.
 *
 * Returns the position just past them, or -1 when they cannot spell it. A run of
 * one word is the ordinary exact match and carries no minimum, because that is
 * the plain case every phrase already relied on.
 */
function glueForward(words: string[], from: number, word: string): number {
  if (from >= words.length || word.length === 0) return -1;

  let glued = '';
  const run: string[] = [];
  let cursor = from;

  while (cursor < words.length && glued.length < word.length) {
    const piece = words[cursor];
    run.push(piece);
    glued += piece;
    cursor += 1;

    if (glued.length > word.length) return -1;
    if (glued !== word) continue;

    if (run.length === 1) return cursor;
    if (glued.length < MIN_GLUE_WORD) return -1;
    if (run.some((fragment) => fragment.length < MIN_GLUE_FRAGMENT)) return -1;
    return cursor;
  }
  return -1;
}

/**
 * Trims and length-caps free text before it reaches the rules.
 *
 * Moderation refuses to inspect text the caller could not have stored anyway, so
 * the check endpoint and the rules agree on what "too long" means.
 */
export function isWithinLimit(field: 'title' | 'description', raw: string): boolean {
  const limit = field === 'title' ? LIMITS.titleMax : LIMITS.descriptionMax;
  return raw.length <= limit;
}

/* ------------------------------------------------------------- bulk term index */

/**
 * A lookup shape for a term list far too large to test one term at a time.
 *
 * `containsTerm` asks "does this one term appear", which is the right question
 * for a hand-written list of a few dozen words. A generated list runs to thousands
 * of entries, and asking the question thousands of times per listing is the
 * difference between a screen that returns instantly and one that does not.
 *
 * The index changes only *how* a term is found, never *whether* it matches:
 *
 *   - a single-word term is still a whole word, never a substring;
 *   - a single-word term is still also compared folded, so "fuuuck" is caught;
 *   - a multi-word term is still a contiguous phrase in the normalized text.
 *
 * The term list is split into three buckets so that each is only visited when the
 * listing actually contains the key it is filed under. A listing without the word
 * "and" never walks the phrases that start with "and".
 */
export interface TermIndex {
  /** Single-word terms filed under their exact normalized word. */
  byWord: Map<string, CompiledWord[]>;
  /** Single-word terms filed under their folded form, when folding is trustworthy. */
  bySquashed: Map<string, CompiledWord[]>;
  /** Multi-word terms filed under their first word. */
  byPhraseHead: Map<string, CompiledWord[]>;
  singleCount: number;
  phraseCount: number;
  /** Terms dropped for being empty once normalized, which can never match. */
  emptyCount: number;
}

function pushTerm(map: Map<string, CompiledWord[]>, key: string, term: CompiledWord): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(term);
  else map.set(key, [term]);
}

/** Builds the lookup shape once per process rather than per listing. */
export function buildTermIndex(terms: readonly CompiledWord[]): TermIndex {
  const byWord = new Map<string, CompiledWord[]>();
  const bySquashed = new Map<string, CompiledWord[]>();
  const byPhraseHead = new Map<string, CompiledWord[]>();
  let singleCount = 0;
  let phraseCount = 0;
  let emptyCount = 0;

  for (const term of terms) {
    if (term.spaced.length === 0) {
      emptyCount += 1;
      continue;
    }
    if (term.spaced.includes(' ')) {
      pushTerm(byPhraseHead, term.spaced.slice(0, term.spaced.indexOf(' ')), term);
      phraseCount += 1;
      continue;
    }
    singleCount += 1;
    pushTerm(byWord, term.spaced, term);
    // Same trust rule as `containsTerm`: a folded comparison only counts once the
    // folded form is long enough that a collision is not a cheap accident.
    if (term.squashed.length >= SQUASH_MIN) pushTerm(bySquashed, term.squashed, term);
  }

  return { byWord, bySquashed, byPhraseHead, singleCount, phraseCount, emptyCount };
}

/**
 * Every term in `index` that appears in `target`, each one reported once.
 *
 * A single-word term is filed under both its exact and its folded form, so a word
 * that matches both ways is found twice. The result is de-duplicated by identity,
 * which keeps "how many terms matched" an honest count instead of a count of lookups.
 *
 * The returned terms are for offline measurement only. Nothing on a request path
 * may put one into a response, a log line or an error message: a caller that can
 * read back the matched term can rebuild the whole list one listing at a time.
 */
export function indexMatches(target: MatchTarget, index: TermIndex): CompiledWord[] {
  const hits = new Set<CompiledWord>();

  for (const word of target.words) {
    const exact = index.byWord.get(word);
    if (exact) for (const term of exact) hits.add(term);

    const folded = index.bySquashed.get(squashWord(word));
    if (folded) for (const term of folded) hits.add(term);
  }

  if (index.byPhraseHead.size > 0) {
    // The spaced form is the phrase form, so the head key is the first token of
    // that same string. A phrase can only match where its first word is present,
    // so the candidate list is only walked at those positions.
    for (const head of target.spaced.split(' ')) {
      const candidates = index.byPhraseHead.get(head);
      if (!candidates) continue;
      for (const candidate of candidates) {
        if (phraseOccurs(target.spaced, candidate.spaced)) hits.add(candidate);
      }
    }
  }

  return [...hits];
}
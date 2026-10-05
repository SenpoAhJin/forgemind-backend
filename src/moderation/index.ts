/**
 * Listing moderation.
 *
 * `moderateListing` is a pure function: same input, same output, no I/O, no
 * clock, no randomness. That makes the rules trivially testable and means the
 * check endpoint and any future listing write path can share one implementation.
 *
 * Design rules that matter more than the word lists themselves:
 *
 * 1. Conservative. Ambiguous input is ALLOWED. A false positive costs a real
 *    seller a listing; a false negative is caught later by a report or a Head.
 * 2. Messages never echo the matched term and never name the rule set, so the
 *    response cannot be used to reconstruct the lists by probing.
 * 3. Context beats prohibition. "EVA foam gun prop" is the single most common
 *    legitimate cosplay listing and it contains a weapon word.
 */

import {
  compileWord,
  containsTerm,
  indexMatches,
  isWithinLimit,
  normalizeText,
  toCombinedTarget,
  toTarget,
  type CompiledWord,
  type MatchTarget,
  type TermIndex,
} from './normalize';
import {
  VULGAR_TERMS,
  ADULT_TERMS,
  HATE_TERMS,
  PROHIBITED_ITEM_TERMS,
  PROHIBITED_CONTEXT,
  UNRELATED_TERMS,
  COSPLAY_TERMS,
  ALLOWLIST,
  blockedTermIndex,
  languageAllowlist,
  languageTermCode,
  languageTermMatches,
  LIMITS,
} from './rules';

export type ViolationCode =
  | 'VULGAR'
  | 'ADULT'
  | 'HATE'
  | 'PROHIBITED_ITEM'
  | 'UNRELATED'
  | 'BLOCKED_TERM';

export interface Violation {
  field: 'title' | 'description';
  code: ViolationCode;
  message: string;
}

export interface ModerationResult {
  allowed: boolean;
  violations: Violation[];
}

export interface ListingInput {
  title: string;
  description: string;
  category: string;
}

/** Generic per-code copy. Never includes the matched term or the list. */
const MESSAGES: Record<ViolationCode, string> = {
  VULGAR: 'This contains language that is not allowed. Please reword it.',
  ADULT: 'This contains adult content that is not allowed. Please reword it.',
  HATE: 'This contains hateful or demeaning language that is not allowed. Please reword it.',
  PROHIBITED_ITEM:
    'Real weapons, ammunition, drugs, counterfeit documents and stolen goods cannot be listed. Cosplay replicas and props are fine.',
  UNRELATED: 'This marketplace is for cosplay-related items and services.',
  BLOCKED_TERM:
    'This contains wording that is not allowed on this marketplace. Please reword it.',
};

/** Minimum length before a folded match on the squashed form is trusted. */
const SQUASH_MIN_LENGTH = 5;

/**
 * The generated term index, resolved once per process on first use.
 *
 * Held in a local rather than read at module scope because the generated list is
 * compiled through the same normalizer this file uses, and the two modules sit on
 * either side of an import cycle. See rules/blockedTerms.ts for the full reason.
 */
let generatedTerms: TermIndex | null = null;

function datasetTerms(): TermIndex {
  if (generatedTerms === null) generatedTerms = blockedTermIndex();
  return generatedTerms;
}

/**
 * The clean-word allowlist from the per-language files, resolved once on first
 * use for the same reason `datasetTerms` is: the list is compiled through the
 * normalizer this file uses, and a module-scope build would race it.
 */
let languageAllow: CompiledWord[] | null = null;

function languageAllowTerms(): CompiledWord[] {
  if (languageAllow === null) languageAllow = [...languageAllowlist()];
  return languageAllow;
}

/**
 * Pre-computed rule forms, built once per process rather than per request. The
 * source lists in ./rules stay readable; this is the fast lookup shape.
 */
const COMPILED = {
  vulgar: VULGAR_TERMS.map(compileWord),
  adult: ADULT_TERMS.map(compileWord),
  hate: HATE_TERMS.map(compileWord),
  prohibited: PROHIBITED_ITEM_TERMS.map(compileWord),
  context: PROHIBITED_CONTEXT.map(compileWord),
  unrelated: UNRELATED_TERMS.map(compileWord),
  cosplay: COSPLAY_TERMS.map(compileWord),
  allow: ALLOWLIST.map(compileWord),
};

/**
 * True when `target` holds an allowlisted word that is a longer version of the
 * hit term.
 *
 * The allowlist rescues a single hit, never a whole field: skipping the field
 * would let one innocent word switch every rule off. Only a *strictly longer*
 * allowlisted word counts, which is the classic substring case, where a short
 * rule term sits inside a perfectly ordinary long word. A word identical to the
 * term gets no rescue, so a term that also appears in the allowlist still
 * blocks.
 */
function isAllowlistedHit(target: MatchTarget, term: CompiledWord): boolean {
  if (term.spaced.length === 0) return false;
  return COMPILED.allow.some((entry) => {
    if (entry.spaced.length <= term.spaced.length) return false;
    if (!containsTerm(target, entry)) return false;
    return entry.spaced.includes(term.spaced) || entry.squashed.includes(term.squashed);
  });
}

/**
 * The same rescue, applied to the per-language allowlist.
 *
 * Kept separate from `isAllowlistedHit` rather than folded into it because the
 * per-language list is four hundred words built from clean-row frequency, and it
 * is expected to change on every regeneration. Sharing one array would mean a
 * rebuild of one file could silently tighten or loosen the other's behaviour.
 */
function isAllowlistedLanguageHit(target: MatchTarget, term: CompiledWord): boolean {
  if (term.spaced.length === 0) return false;
  return languageAllowTerms().some((entry) => {
    if (entry.spaced.length <= term.spaced.length) return false;
    if (!containsTerm(target, entry)) return false;
    return entry.spaced.includes(term.spaced) || entry.squashed.includes(term.squashed);
  });
}

/** Any term in `terms` appears in `target` and is not rescued by the allowlist. */
function hasHit(target: MatchTarget, terms: CompiledWord[]): boolean {
  return terms.some((term) => containsTerm(target, term) && !isAllowlistedHit(target, term));
}

/** True when any cosplay term is present. Used to resolve UNRELATED ambiguity. */
function hasCosplayContext(target: MatchTarget): boolean {
  return hasHit(target, COMPILED.cosplay);
}

/** True when any prop/replica/toy qualifier is present. */
function hasItemContext(target: MatchTarget): boolean {
  return hasHit(target, COMPILED.context);
}

/** Does the listing text talk about this category at all? */
function matchesCategory(target: MatchTarget, category: string): boolean {
  return normalizeText(category)
    .spaced.split(' ')
    .filter((word) => word.length > 2)
    .some((word) => containsTerm(target, compileWord(word)));
}

/**
 * Runs the rules against a listing.
 *
 * Categories are NOT validated here: that is the caller's job and it already
 * exists on the create form. The endpoint rejects an unknown category with 400
 * before calling this, so a bad category cannot reach the unrelated rule.
 */
export function moderateListing(listing: ListingInput): ModerationResult {
  const violations: Violation[] = [];
  const combined = toCombinedTarget(listing.title, listing.description);

  for (const field of ['title', 'description'] as const) {
    const raw = listing[field] ?? '';
    if (raw.length === 0) continue;
    if (!isWithinLimit(field, raw)) {
      // Over-long input is the transport layer's problem, not moderation's.
      continue;
    }

    const target = toTarget(raw);

    const push = (code: ViolationCode): void => {
      violations.push({ field, code, message: MESSAGES[code] });
    };

    // Hate first: it is the most serious and a listing can trip several rules.
    if (hasHit(target, COMPILED.hate)) {
      push('HATE');
    }
    if (hasHit(target, COMPILED.vulgar)) {
      push('VULGAR');
    }
    if (hasHit(target, COMPILED.adult)) {
      push('ADULT');
    }

    // Prohibited goods, unless a prop/replica qualifier is present.
    if (!hasItemContext(target) && hasHit(target, COMPILED.prohibited)) {
      push('PROHIBITED_ITEM');
    }

    // The generated list, checked last so a curated, more specific code always
    // wins the message the seller reads. Same normalize step and the same
    // whole-word / contiguous-phrase matching as every list above.
    if (indexMatches(target, datasetTerms()).length > 0) {
      push('BLOCKED_TERM');
    }

    // The per-language lists. Same normalizer, same matcher, but each hit
    // reports the code its own class earned, so the seller reads the message for
    // the kind of problem rather than one generic sentence. Coded rules keep the
    // exemptions the curated rules have: a prop qualifier still rescues a
    // prohibited item, and cosplay context still rescues relevance.
    const seen = new Set<ViolationCode>();
    for (const term of languageTermMatches(target)) {
      if (isAllowlistedLanguageHit(target, term)) continue;
      const code = languageTermCode(term.spaced);
      if (code === undefined || seen.has(code)) continue;
      if (code === 'PROHIBITED_ITEM' && hasItemContext(target)) continue;
      if (
        code === 'UNRELATED' &&
        (hasCosplayContext(combined) || hasItemContext(target) || matchesCategory(combined, listing.category))
      ) {
        continue;
      }
      seen.add(code);
      push(code);
    }

    // Unrelated goods, only when nothing in the listing ties it to cosplay.
    // Any cosplay term, a qualifying context word, or the selected category
    // appearing in the text means the listing is ambiguous, so it is allowed.
    if (
      hasHit(target, COMPILED.unrelated) &&
      !hasCosplayContext(combined) &&
      !hasItemContext(target) &&
      !matchesCategory(combined, listing.category)
    ) {
      push('UNRELATED');
    }
  }

  return { allowed: violations.length === 0, violations };
}

/**
 * Text-only variant used for the seller display name at registration, where
 * relevance is meaningless and a category does not exist. Only the language
 * rules apply; a display name is never blocked for being unrelated.
 */
export function moderateDisplayName(displayName: string): ModerationResult {
  const violations: Violation[] = [];
  if (!displayName || displayName.length === 0) {
    return { allowed: true, violations };
  }
  const target = toTarget(displayName);

  // Hate first, then the other language rules. Relevance never applies here.
  if (hasHit(target, COMPILED.hate)) {
    violations.push({ field: 'title', code: 'HATE', message: MESSAGES.HATE });
  }
  if (hasHit(target, COMPILED.vulgar)) {
    violations.push({ field: 'title', code: 'VULGAR', message: MESSAGES.VULGAR });
  }
  if (hasHit(target, COMPILED.adult)) {
    violations.push({ field: 'title', code: 'ADULT', message: MESSAGES.ADULT });
  }
  if (indexMatches(target, datasetTerms()).length > 0) {
    violations.push({ field: 'title', code: 'BLOCKED_TERM', message: MESSAGES.BLOCKED_TERM });
  }
  return { allowed: violations.length === 0, violations };
}

export { LIMITS };
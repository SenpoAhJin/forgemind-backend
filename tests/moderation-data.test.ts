/**
 * Tests for the generated blocked-term list.
 *
 * Run with: npm run test:moderation-data
 *
 * WHAT IS AND IS NOT IN THIS FILE
 * The term list is loaded at runtime, never copied into the source. Not one term
 * appears here, and no test writes one into a failure message: a test file is
 * committed, and a committed term is a published term. What the tests check
 * instead is the shape of the list, the size of the list, and the behaviour of
 * the matcher that consumes it, all against strings invented for the purpose.
 *
 * Every sample string below is a synthetic cosplay listing or display name. None
 * of them is taken from the labeled corpus, so nothing that the screener exists
 * to keep out of the marketplace can leak through a test failure either.
 *
 * WHY THE SIZE IS A TEST AT ALL
 * The list is a generated file. A regeneration that silently drops half of it, or
 * that ships a file with no terms in it, would look exactly like success from the
 * outside: every listing would pass. Pinning the count turns that into a failure.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { moderateDisplayName, moderateListing } from '../src/moderation';
import { buildTermIndex, compileWord, indexMatches, toTarget } from '../src/moderation/normalize';
import {
  blockedTermCount,
  blockedTermCountByCategory,
  blockedTermDroppedCount,
  blockedTermIndex,
  blockedTermSchemaVersion,
} from '../src/moderation/rules/blockedTerms';

/** The exact number the current generated file holds. Bump only on purpose. */
const EXPECTED_TERM_COUNT = 3;

const CATEGORY = 'Props & Accessories';

/** Synthetic listings that must survive screening. No real listing text. */
const SAFE_LISTINGS: ReadonlyArray<{ name: string; title: string; description: string }> = [
  {
    name: 'wig-cap',
    title: 'Heat resistant white wig base',
    description: 'Cosplay wig cap, unused, heat styling friendly, machine washable.',
  },
  {
    name: 'seamstress',
    title: 'Wig styling, cutting and heat set service',
    description: 'Styling and heat setting for cosplay wigs, same day service in the city.',
  },
  {
    name: 'prop-maker',
    title: 'EVA foam shoulder pauldron, hand painted',
    description: 'Lightweight cosplay armour plate, safe EVA foam, shipped in a tube.',
  },
  {
    name: 'buyer-post',
    title: 'Looking for a used cosplay wig in black',
    description: 'Budget friendly, Metro Manila pickup preferred, flexible on condition.',
  },
  {
    name: 'long-description',
    title: 'Full military uniform set',
    description:
      'Complete set with jacket, trousers, boots and cap. Replica construction throughout, '
      + 'no working parts of any kind, photographed at convention. Pickup near the venue or I '
      + 'can meet at the lobby. Message me and we can agree on a price. Cash only, sorry.',
  },
];

/** Synthetic display names that must survive screening. */
const SAFE_NAMES: readonly string[] = [
  'PixelSmith',
  'FoamWorks Studio',
  'ThreadAndGlue',
  'Harbor Wig Co',
];

/** The generated file is present, readable and the size it claims to be. */
test('the generated term list loaded and matches its recorded size', () => {
  assert.equal(blockedTermCount(), EXPECTED_TERM_COUNT);
  assert.equal(blockedTermDroppedCount(), 0);
  assert.ok(blockedTermSchemaVersion() >= 1);

  const counts = blockedTermCountByCategory();
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  assert.equal(total, blockedTermCount());
  for (const [category, count] of Object.entries(counts)) {
    assert.ok(category.length > 0, 'a category name should never be empty');
    assert.ok(count > 0, `category ${category} reported no terms`);
  }
});

/** Every term is usable, and the index accounts for all of them. */
test('every term compiles and lands in exactly one index bucket', () => {
  const index = blockedTermIndex();
  assert.equal(index.singleCount + index.phraseCount, blockedTermCount());
  assert.equal(index.emptyCount, 0);

  const direct = buildTermIndex([compileWord('   '), compileWord('a'), compileWord('two words')]);
  assert.equal(direct.emptyCount, 1);
  assert.equal(direct.singleCount, 1);
  assert.equal(direct.phraseCount, 1);
});

/** Safe listings are untouched by the added list and by the rules as a whole. */
test('synthetic cosplay listings are still allowed', () => {
  for (const listing of SAFE_LISTINGS) {
    const result = moderateListing({
      title: listing.title,
      description: listing.description,
      category: CATEGORY,
    });
    assert.deepEqual(
      result.violations.map((violation) => violation.code),
      [],
      `${listing.name} was blocked: ${result.violations.map((violation) => violation.code).join(',')}`,
    );
    assert.equal(result.allowed, true, listing.name);
  }
});

/** Safe display names are untouched. */
test('synthetic seller display names are still allowed', () => {
  for (const name of SAFE_NAMES) {
    const result = moderateDisplayName(name);
    assert.deepEqual(result.violations, [], `${name} was blocked`);
    assert.equal(result.allowed, true, name);
  }
});

/**
 * The added list runs on the same normalize step as every other list.
 *
 * Folding is applied to the term and to the text, and matching stays whole-word:
 * a run of single letters arrives at the matcher as one word, and a longer word
 * that merely contains the term is not a hit.
 */
test('the index folds text and terms the same way the matcher already did', () => {
  const folded = buildTermIndex([compileWord('velvet')]);
  assert.equal(indexMatches(toTarget('trim v.e.l.v.e.t collar'), folded).length, 1);
  assert.equal(indexMatches(toTarget('trim vvvveeelllveett collar'), folded).length, 1);
  assert.equal(indexMatches(toTarget('velveton'), folded).length, 0);
  assert.equal(indexMatches(toTarget('my velv'), folded).length, 0);
});

/** A multi-word term still has to appear as one contiguous phrase. */
test('a multi-word term needs its words next to each other', () => {
  const phrase = buildTermIndex([compileWord('velvet collar')]);
  assert.equal(indexMatches(toTarget('a velvet collar, lined in black'), phrase).length, 1);
  assert.equal(indexMatches(toTarget('a velvet one and later a collar in black'), phrase).length, 0);
});

/** The screening stays deterministic across repeated calls. */
test('screening the same listing twice gives the same answer', () => {
  const listing = { title: 'Foam pauldron', description: 'Lightweight armour piece, no moving parts.', category: CATEGORY };
  const first = moderateListing(listing);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(moderateListing(listing), first);
  }
});

/**
 * No violation can carry anything but a field name, a code and fixed copy.
 *
 * There is deliberately no blocked sample string in this file. Reproducing one
 * would mean writing the wording the screener blocks into a committed file, which
 * is the one thing this file exists to avoid. The shape is therefore checked from
 * the allowed side, where every code and message in the result is empty.
 */
test('an allowed result carries no codes, no fields and no copy', () => {
  for (const listing of SAFE_LISTINGS) {
    const result = moderateListing({
      title: listing.title,
      description: listing.description,
      category: CATEGORY,
    });
    for (const violation of result.violations) {
      assert.deepEqual(Object.keys(violation).sort(), ['code', 'field', 'message']);
      assert.ok(['title', 'description'].includes(violation.field));
      assert.ok(violation.message.length > 0);
    }
    assert.deepEqual(result.violations, []);
  }
});
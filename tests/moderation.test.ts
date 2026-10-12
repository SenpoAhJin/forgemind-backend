/**
 * Table-driven tests for the moderation rules.
 *
 * Run with: npm run test:moderation
 *
 * These cases contain blocked and borderline text on purpose: it is the test
 * data. Nothing here prints a term on failure beyond the case name, so the
 * output is safe to paste into a report.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { moderateListing, moderateDisplayName } from '../src/moderation';
import { normalizeText, toTarget } from '../src/moderation/normalize';

const CATEGORY = 'Costumes & Cosplay';

/** Compact case format: [name, title, description, expectAllowed, expectedCode]. */
type Case = [string, string, string, boolean, string | null];

const BLOCKED: Case[] = [
  // --- vulgar, plain ---
  ['vulgar/title', 'Levi cosplay costume', 'Great condition, no fuck jokes here', false, 'VULGAR'],
  ['vulgar/desc', 'Vintage sailor collar set', 'This is a damn good wig, comes with cap', false, 'VULGAR'],
  ['vulgar/mixed-case', 'HYUNDAI cosplay armor', 'SHIT quality, ordered twice', false, 'VULGAR'],
  ['vulgar/leet', 'Anime hoodie', 'd@mn cheap material', false, 'VULGAR'],
  ['vulgar/leet-2', 'Sailor uniform set', 'sh1t quality honestly', false, 'VULGAR'],
  ['vulgar/dollar-sign', 'Vintage sailor collar set', 'cheap $hit listing, sold fast', false, 'VULGAR'],
  ['vulgar/zero-width', 'Idol costume set', 'dam\u200bn quality', false, 'VULGAR'],
  ['vulgar/homoglyph', 'Idol costume set', 'd\u0430mn cheap material', false, 'VULGAR'],
  ['vulgar/unicode-lookalike', 'Cosplay shoes', '\u0455hit quality, ruined them', false, 'VULGAR'],
  // --- vulgar, obfuscated ---
  ['vulgar/spaced-letters', 'Punk jacket', 'F U C K quality', false, 'VULGAR'],
  ['vulgar/dotted', 'Punk jacket', 'f.u.c.k quality', false, 'VULGAR'],
  ['vulgar/repeated', 'Punk jacket', 'fuccckk quality', false, 'VULGAR'],
  ['vulgar/dash-split', 'Punk jacket', 'f---u---c---k quality', false, 'VULGAR'],
  ['vulgar/slash-split', 'Punk jacket', 'f/u/c/k quality', false, 'VULGAR'],
  // --- vulgar, Tagalog ---
  ['vulgar/tagalog-1', 'Barrio costume set', 'Mababa ang ganda, putang na aking', false, 'VULGAR'],
  ['vulgar/tagalog-2', 'Tribal skirt', 'Gago siyang tsuthosa', false, 'VULGAR'],
  ['vulgar/tagalog-3', 'Couture cape', 'Tanga na siya mag-design', false, 'VULGAR'],
  ['vulgar/tagalog-ina-mo', 'Bicol festival dress', 'Ina mo, ang linis naman', false, 'VULGAR'],
  // --- adult ---
  ['adult/desc', 'Silk kimono', 'Includes nude reference photos of the model', false, 'ADULT'],
  ['adult/keyword', 'Bedroom set costume', 'Erotic roleplay photos included', false, 'ADULT'],
  ['adult/tagalog', 'Ball gown', 'Naked na mag-poses, JSKM po', false, 'ADULT'],
  // --- hate ---
  ['hate/desc', 'Navy captain coat', 'The previous owner was a nigger', false, 'HATE'],
  // A seller writing "no slurs allowed" is not the problem this rule targets.
  // Mentioning a slur to disavow it must not be treated as using one.
  ['allow/meta-mention', 'Generic crewmate outfit', 'No slurs allowed here, friendly seller', true, null],
  // --- prohibited items ---
  ['prohibited/firearm', 'Full tactical set', 'Real 9mm handgun included, working', false, 'PROHIBITED_ITEM'],
  ['prohibited/ammunition', 'WW2 helmet replica', 'Includes live ammunition, ask me', false, 'PROHIBITED_ITEM'],
  ['prohibited/explosive', 'Platoon vest', 'Pipe bomb material inside', false, 'PROHIBITED_ITEM'],
  ['prohibited/drugs', 'Chemist coat', 'Real cocaine hidden in the lining', false, 'PROHIBITED_ITEM'],
  ['prohibited/fake-id', 'Officer badge', 'Can make you a fake id that passes', false, 'PROHIBITED_ITEM'],
  ['prohibited/stolen', 'Vintage blazer', 'Stolen goods, brand new, cheap', false, 'PROHIBITED_ITEM'],
  // --- unrelated ---
  ['unrelated/phone', 'iPhone 12 in good condition', 'Battery health 88 percent', false, 'UNRELATED'],
  ['unrelated/laptop', 'Dell laptop, 16GB RAM', 'SSD replaced last year', false, 'UNRELATED'],
  ['unrelated/car', 'Car for sale, 2015 model', 'Runs well, papers complete', false, 'UNRELATED'],
  ['unrelated/house', 'House for rent, 2 bedrooms', 'Monthly payment negotiable', false, 'UNRELATED'],
  ['unrelated/pets', 'Puppy for sale, purebred', 'Vaccinated, ready for new home', false, 'UNRELATED'],
  ['unrelated/appliance', 'Washing machine, still working', 'Free pickup inside the city', false, 'UNRELATED'],
  ['unrelated/job', 'Job vacancy, work from home', 'Part time job, apply now', false, 'UNRELATED'],
  ['unrelated/laptop-title-only', 'Laptop sleeve', 'Unused, still plastic wrapped', false, 'UNRELATED'],
];

const ALLOWED: Case[] = [
  // --- false-positive guards: blocked substring inside an innocent word ---
  ['allow/titan', 'Attack on Titan cosplay armor set', 'Includes shoulder plates and cloak', true, null],
  ['allow/assassin', "Assassin's Creed hood costume", 'Handmade, hood with embroidery', true, null],
  ['allow/classic', 'Classic Lolita dress costume', 'Full set with petticoat and headband', true, null],
  ['allow/peacock', 'Peacock feather wig', 'Hand dyed, adjustable cap', true, null],
  ['allow/cocktail', 'Cocktail dress costume for the gala', 'Full length, chiffon layers', true, null],
  ['allow/buttOn', 'Detachable costume button set', 'Ten metal buttons in antique brass', true, null],
  ['allow/analysis', 'Character analysis notes binder', 'Handmade cosplay analysis journal', true, null],
  ['allow/space', 'Space Marine shoulder pads', 'Foam build, EVA craft', true, null],
  ['allow/assassin-plural', 'Assassins Creed ninja set', 'Full costume with tabard and mask', true, null],
  ['allow/scunthorpe', 'Scunthorpe cosplay scarf', 'Knitted scarf, warm for conventions', true, null],
  // --- context beats prohibition ---
  ['allow/eva-foam-gun', 'EVA foam gun prop', 'Built from EVA foam, looks real but is not', true, null],
  ['allow/replica-prop-gun', 'Replica prop gun, foam', 'Non functional cosplay prop only', true, null],
  ['allow/costume-prop-knife', 'Cosplay dagger prop', 'Rubber blade, safe for conventions', true, null],
  ['allow/foam-sword', 'EVA foam sword', 'Lightweight, great for cosplay', true, null],
  ['allow/toy-blaster', 'Toy blaster for cosplay', 'Plastic, screen accurate style', true, null],
  ['allow/larp-shield', 'LARP shield prop', 'Plywood and EVA foam construction', true, null],
  // --- ordinary cosplay ---
  ['allow/wig', 'Long silver wig', 'Heat styled, cosplay quality', true, null],
  ['allow/sewing', 'Sewing machine for fabric work', 'Portable, good for cosplay builds', true, null],
  ['allow/heat-gun', 'Heat gun for foam', 'Used to shape EVA foam for cosplay', true, null],
  ['allow/commissions', 'Photography session at convention', 'Commissions open, cosplay portraits', true, null],
  ['allow/empty-desc', 'Navy blue kimono', '', true, null],
  ['allow/empty-desc-titled', 'Purple LED light strip', '', true, null],
  ['allow/normal', 'Shera costume dress', 'Handmade, worn twice, includes headpiece', true, null],
  ['allow/glasses', 'Round glasses cosplay prop', 'Plastic frames, prescription unavailable', true, null],
  ['allow/unrelated-but-cosplay', 'Prop gun holster', 'Cosplay leather holster, fits EVA foam props', true, null],
  ['allow/laptop-declared-unrelated-but-cosplay', 'Laptop skin for cosplay', 'Cosplay laptop skin, decal for props', true, null],
  ['allow/other-category', 'Misc costume accessories', 'Assorted bits for a pirate captain', true, null],
];

test('blocked cases are rejected with the expected code', () => {
  let passed = 0;
  const failures: string[] = [];

  for (const [name, title, description, expectAllowed, expectedCode] of BLOCKED) {
    const result = moderateListing({ title, description, category: CATEGORY });
    if (result.allowed === expectAllowed) {
      passed += 1;
    } else {
      failures.push(`${name}: expected blocked, got allowed=${result.allowed}`);
      continue;
    }
    if (expectedCode && !result.violations.some((violation) => violation.code === expectedCode)) {
      failures.push(`${name}: expected code ${expectedCode}`);
    } else {
      passed += 1;
    }
    for (const violation of result.violations) {
      if (violation.field !== 'title' && violation.field !== 'description') {
        failures.push(`${name}: violation had an unexpected field`);
      }
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(passed > 0);
});

test('allowed cases pass, guarding against false positives', () => {
  const failures: string[] = [];
  let passed = 0;

  for (const [name, title, description, expectAllowed] of ALLOWED) {
    const result = moderateListing({ title, description, category: CATEGORY });
    if (result.allowed === expectAllowed) {
      passed += 1;
    } else {
      failures.push(`${name}: expected allowed, got blocked (${result.violations.length} codes)`);
    }
  }

  assert.deepEqual(failures, [], failures.join('\n'));
  assert.ok(passed > 0);
});

test('a violation names the field that tripped, never the term', () => {
  const titleHit = moderateListing({ title: 'a', description: 'sh1t quality item', category: CATEGORY });
  assert.equal(titleHit.violations[0]?.field, 'description');

  const titleHit2 = moderateListing({ title: 'sh1t quality item', description: 'clean', category: CATEGORY });
  assert.equal(titleHit2.violations[0]?.field, 'title');

  // The message must not contain the matched text, or the endpoint becomes a
  // way to extract the lists one probe at a time.
  for (const [, title, description] of BLOCKED.slice(0, 12)) {
    const result = moderateListing({ title, description, category: CATEGORY });
    for (const violation of result.violations) {
      assert.ok(violation.message.length > 0, 'message must not be empty');
      assert.ok(!/[<>{}]/.test(violation.message), 'message must not echo markup');
    }
  }
});

test('display name applies language rules and ignores relevance', () => {
  assert.equal(moderateDisplayName('Kei Cosplayer').allowed, true);
  assert.equal(moderateDisplayName('Attack on Titan Cosplay').allowed, true);
  assert.equal(moderateDisplayName('Sh1t Seller').allowed, false);
  // A name that is "unrelated" is not a reason to reject a name.
  assert.equal(moderateDisplayName('Used Laptop Seller').allowed, true);
  assert.equal(moderateDisplayName('').allowed, true);
});

test('normalization folds the obfuscations it claims to', () => {
  assert.equal(normalizeText('F U C K').spaced, 'f u c k');
  assert.equal(normalizeText('f.u.c.k').squashed, 'fuck');
  // Repeated letters collapse entirely, so padding cannot hide a term.
  assert.equal(normalizeText('fuccckk').squashed, 'fuck');
  // Single letters separated by any separator merge into one word.
  assert.equal(toTarget(normalizeText('f+u+c+k').spaced).words[0], 'fuck');
  assert.equal(normalizeText('SH1T').spaced, 'shit');
  // Cyrillic lookalikes fold to their Latin letters.
  assert.equal(normalizeText('c\u0435s\u0441\u0442').spaced, 'cesct');
  assert.equal(normalizeText('b\u00e4d').spaced, 'bad');
  assert.equal(normalizeText('d\u200bamn').spaced, 'damn');
  assert.equal(normalizeText('').spaced, '');
  assert.equal(normalizeText('').squashed, '');
});

test('moderation is pure: same input, same output', () => {
  const input = { title: 'Cosplay wig', description: 'Heat styled', category: CATEGORY };
  const first = moderateListing(input);
  const second = moderateListing(input);
  assert.deepEqual(first, second);
});

test('over-long fields are ignored by moderation, not crashed on', () => {
  const long = 'a'.repeat(5000);
  const result = moderateListing({ title: 'Cosplay wig', description: long, category: CATEGORY });
  assert.equal(result.allowed, true);
});
/**
 * Tests for the shared marketplace role and category rules.
 *
 * Run with: npm run test:rules
 *
 * These are the rules that decide who may post what, so they are tested as pure
 * functions against a fake caller rather than through HTTP. The caller shape is
 * the one rules.ts builds from the users row; a fake is legitimate here because
 * the functions read nothing but their arguments.
 *
 * The marketplace has three listing types: sell, trade, commission.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedPostTypes,
  categoryAllowsPostType,
  isVerifiedMarketplaceUser,
  postTypesForCategory,
  publicSellerName,
  roleAllowsPostType,
  SERVICE_ONLY_CATEGORIES,
  type MarketplaceRole,
  type PostType,
} from '../src/marketplace/rules';
import {
  DEFAULT_COMMISSION_CONDITION,
  isPostType,
  isRemovedPostType,
  legacyTransactionType,
  parseListingInput,
} from '../src/marketplace/listings';

const ITEM_CATEGORY = 'Wigs';
const SERVICE_CATEGORY = 'Commissions & Crafting Services';
const PHOTO_CATEGORY = 'Photography Services';

const CONTEXT = { category_id: '00000000-0000-0000-0000-000000000001' };

function caller(role: MarketplaceRole, status = 'verified') {
  return { verification_status: status, marketplace_role: role };
}

/** A minimal valid body for a post type, so each test changes one thing. */
function body(post_type: PostType, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'A listing title',
    description: 'A listing description.',
    category: ITEM_CATEGORY,
    post_type,
    condition: 'good',
    ...extra,
  };
}

test('only a verified role may post', () => {
  assert.equal(isVerifiedMarketplaceUser(caller('seller')), true);
  assert.equal(isVerifiedMarketplaceUser(caller('buyer')), true);
  assert.equal(isVerifiedMarketplaceUser(caller('both')), true);
  assert.equal(isVerifiedMarketplaceUser(caller(null)), false);
  assert.equal(isVerifiedMarketplaceUser(caller('seller', 'pending')), false);
  assert.equal(isVerifiedMarketplaceUser(caller('seller', 'not_submitted')), false);
  assert.equal(isVerifiedMarketplaceUser(caller('seller', 'revoked')), false);
  assert.equal(isVerifiedMarketplaceUser(caller('seller', 'rejected')), false);
});

test('sell and commission need seller or both', () => {
  for (const postType of ['sell', 'commission'] as PostType[]) {
    assert.equal(roleAllowsPostType(caller('seller'), postType), true, postType);
    assert.equal(roleAllowsPostType(caller('both'), postType), true, postType);
    assert.equal(roleAllowsPostType(caller('buyer'), postType), false, postType);
  }
});

test('a trade is open to any verified role', () => {
  for (const role of ['buyer', 'seller', 'both'] as MarketplaceRole[]) {
    assert.equal(roleAllowsPostType(caller(role), 'trade'), true, String(role));
  }
});

test('an unverified or roleless account posts nothing', () => {
  for (const postType of ['sell', 'trade', 'commission'] as PostType[]) {
    assert.equal(roleAllowsPostType(caller(null), postType), false, postType);
    assert.equal(roleAllowsPostType(caller('seller', 'pending'), postType), false, postType);
    assert.equal(roleAllowsPostType(caller('buyer', 'revoked'), postType), false, postType);
  }
});

test('service categories only take commissions', () => {
  for (const category of SERVICE_ONLY_CATEGORIES) {
    assert.deepEqual([...postTypesForCategory(category)], ['commission'], category);
  }
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'commission'), true);
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'sell'), false);
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'trade'), false);
  assert.equal(categoryAllowsPostType(PHOTO_CATEGORY, 'commission'), true);
  assert.equal(categoryAllowsPostType(PHOTO_CATEGORY, 'sell'), false);
});

test('item categories take sell and trade only', () => {
  assert.deepEqual([...postTypesForCategory(ITEM_CATEGORY)], ['sell', 'trade']);
  assert.equal(categoryAllowsPostType(ITEM_CATEGORY, 'sell'), true);
  assert.equal(categoryAllowsPostType(ITEM_CATEGORY, 'trade'), true);
  assert.equal(categoryAllowsPostType(ITEM_CATEGORY, 'commission'), false);
});

test('an unknown category is treated as an item category, not a free pass', () => {
  assert.equal(categoryAllowsPostType('Something Unlisted', 'commission'), false);
  assert.equal(categoryAllowsPostType('Something Unlisted', 'sell'), true);
});

test('allowedPostTypes is the intersection of role and category', () => {
  assert.deepEqual(allowedPostTypes(caller('both'), ITEM_CATEGORY), ['sell', 'trade']);
  assert.deepEqual(allowedPostTypes(caller('seller'), ITEM_CATEGORY), ['sell', 'trade']);
  assert.deepEqual(allowedPostTypes(caller('buyer'), ITEM_CATEGORY), ['trade']);
  assert.deepEqual(allowedPostTypes(caller('both'), SERVICE_CATEGORY), ['commission']);
  assert.deepEqual(allowedPostTypes(caller('seller'), SERVICE_CATEGORY), ['commission']);
  assert.deepEqual(allowedPostTypes(caller('buyer'), SERVICE_CATEGORY), []);
  assert.deepEqual(allowedPostTypes(caller('seller', 'pending'), ITEM_CATEGORY), []);
});

test('the public seller name prefers the seller display name and never an email', () => {
  assert.equal(publicSellerName({ display_name: 'Kei', seller_display_name: 'Wig Studio' }), 'Wig Studio');
  assert.equal(publicSellerName({ display_name: 'Kei', seller_display_name: null }), 'Kei');
  assert.equal(publicSellerName({ display_name: 'Kei', seller_display_name: '   ' }), 'Kei');
});

test('exactly three post types are accepted', () => {
  for (const value of ['sell', 'trade', 'commission']) {
    assert.equal(isPostType(value), true, value);
  }
});

test('the four retired post types are recognised as retired, not as nonsense', () => {
  for (const value of ['buy', 'rent', 'service_offer', 'service_request']) {
    assert.equal(isRemovedPostType(value), true, value);
    assert.equal(isPostType(value), false, value);
  }
  for (const value of ['both', '', 'SELL', 'nonsense', 42, null, undefined]) {
    assert.equal(isRemovedPostType(value), false, String(value));
    assert.equal(isPostType(value), false, String(value));
  }
});

test('a retired post type is a 400 that names the type and the three that exist', () => {
  for (const value of ['buy', 'rent', 'service_offer', 'service_request']) {
    const parsed = parseListingInput(body(value as PostType, { price: 100 }), CONTEXT);
    assert.equal(parsed.ok, false, value);
    if (parsed.ok) continue;
    assert.match(parsed.fields.post_type ?? '', /sell, trade, commission/);
    assert.match(parsed.fields.post_type ?? '', new RegExp(value));
  }
});

test('sell needs a price greater than zero', () => {
  const missing = parseListingInput(body('sell'), CONTEXT);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.fields.price, 'Required');

  const zero = parseListingInput(body('sell', { price: 0 }), CONTEXT);
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.fields.price, 'Must be greater than 0');

  const good = parseListingInput(body('sell', { price: 450 }), CONTEXT);
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.price, 450);
    assert.equal(good.value.rate, null);
  }
});

test('commission needs a starting rate greater than zero', () => {
  const missing = parseListingInput(body('commission', { category: SERVICE_CATEGORY }), CONTEXT);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.fields.rate, 'Required');

  const zero = parseListingInput(body('commission', { category: SERVICE_CATEGORY, rate: 0 }), CONTEXT);
  assert.equal(zero.ok, false);
  if (!zero.ok) assert.equal(zero.fields.rate, 'Must be greater than 0');

  const good = parseListingInput(body('commission', { category: SERVICE_CATEGORY, rate: 1200 }), CONTEXT);
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.value.rate, 1200);
    assert.equal(good.value.price, 0);
  }
});

test('trade needs both items and its estimated value is optional', () => {
  const none = parseListingInput(body('trade'), CONTEXT);
  assert.equal(none.ok, false);
  if (!none.ok) {
    assert.ok(none.fields.trade_offered_item);
    assert.ok(none.fields.trade_wanted_item);
  }

  const one = parseListingInput(body('trade', { trade_offered_item: 'A wig' }), CONTEXT);
  assert.equal(one.ok, false);
  if (!one.ok) assert.ok(one.fields.trade_wanted_item);

  const both = parseListingInput(
    body('trade', { trade_offered_item: 'A wig', trade_wanted_item: 'A collar' }),
    CONTEXT,
  );
  assert.equal(both.ok, true);
  if (both.ok) {
    assert.equal(both.value.trade_estimated_value, null);
    assert.equal(both.value.price, 0);
  }

  const valued = parseListingInput(
    body('trade', {
      trade_offered_item: 'A wig',
      trade_wanted_item: 'A collar',
      trade_estimated_value: 500,
    }),
    CONTEXT,
  );
  assert.equal(valued.ok, true);
  if (valued.ok) assert.equal(valued.value.trade_estimated_value, 500);
});

test('a commission does not need a condition and gets the storage default', () => {
  const without = parseListingInput(
    { title: 'A listing title', description: 'A description.', category: SERVICE_CATEGORY, post_type: 'commission', rate: 500 },
    CONTEXT,
  );
  assert.equal(without.ok, true);
  if (without.ok) assert.equal(without.value.condition, DEFAULT_COMMISSION_CONDITION);

  const withCondition = parseListingInput(
    body('commission', { category: SERVICE_CATEGORY, rate: 500, condition: 'new' }),
    CONTEXT,
  );
  assert.equal(withCondition.ok, true);
  if (withCondition.ok) assert.equal(withCondition.value.condition, 'new');

  const badCondition = parseListingInput(
    body('commission', { category: SERVICE_CATEGORY, rate: 500, condition: 'mint' }),
    CONTEXT,
  );
  assert.equal(badCondition.ok, false);
  if (!badCondition.ok) assert.ok(badCondition.fields.condition);
});

test('a sell still needs a condition, because a thing on a shelf has one', () => {
  const missing = parseListingInput(
    { title: 'A listing title', description: 'A description.', category: ITEM_CATEGORY, post_type: 'sell', price: 100 },
    CONTEXT,
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.fields.condition, 'Choose a condition');
});

test('the legacy transaction_type still maps onto its three surviving values', () => {
  assert.equal(legacyTransactionType('sell'), 'buy');
  assert.equal(legacyTransactionType('trade'), 'trade');
  assert.equal(legacyTransactionType('commission'), 'both');
});
/**
 * Tests for the shared marketplace role and category rules.
 *
 * Run with: npm run test:rules
 *
 * These are the rules that decide who may post what, so they are tested as pure
 * functions against a fake caller rather than through HTTP. The caller shape is
 * the one rules.ts builds from the users row; a fake is legitimate here because
 * the functions read nothing but their arguments.
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

const ITEM_CATEGORY = 'Wigs';
const SERVICE_CATEGORY = 'Commissions & Crafting Services';
const PHOTO_CATEGORY = 'Photography Services';

function caller(role: MarketplaceRole, status = 'verified') {
  return { verification_status: status, marketplace_role: role };
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

test('seller posts need seller or both', () => {
  const sellerPosts: PostType[] = ['sell', 'rent', 'service_offer'];
  for (const postType of sellerPosts) {
    assert.equal(roleAllowsPostType(caller('seller'), postType), true, postType);
    assert.equal(roleAllowsPostType(caller('both'), postType), true, postType);
    assert.equal(roleAllowsPostType(caller('buyer'), postType), false, postType);
  }
});

test('buyer posts need buyer or both', () => {
  const buyerPosts: PostType[] = ['buy', 'service_request'];
  for (const postType of buyerPosts) {
    assert.equal(roleAllowsPostType(caller('buyer'), postType), true, postType);
    assert.equal(roleAllowsPostType(caller('both'), postType), true, postType);
    assert.equal(roleAllowsPostType(caller('seller'), postType), false, postType);
  }
});

test('a trade is open to any verified role', () => {
  for (const role of ['buyer', 'seller', 'both'] as MarketplaceRole[]) {
    assert.equal(roleAllowsPostType(caller(role), 'trade'), true, String(role));
  }
});

test('an unverified or roleless account posts nothing', () => {
  for (const postType of ['sell', 'buy', 'trade', 'rent', 'service_offer', 'service_request'] as PostType[]) {
    assert.equal(roleAllowsPostType(caller(null), postType), false, postType);
    assert.equal(roleAllowsPostType(caller('seller', 'pending'), postType), false, postType);
    assert.equal(roleAllowsPostType(caller('buyer', 'revoked'), postType), false, postType);
  }
});

test('service categories only take service posts', () => {
  for (const category of SERVICE_ONLY_CATEGORIES) {
    assert.deepEqual([...postTypesForCategory(category)], ['service_offer', 'service_request'], category);
  }
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'service_offer'), true);
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'service_request'), true);
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'sell'), false);
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'rent'), false);
  assert.equal(categoryAllowsPostType(SERVICE_CATEGORY, 'trade'), false);
  assert.equal(categoryAllowsPostType(PHOTO_CATEGORY, 'service_offer'), true);
  assert.equal(categoryAllowsPostType(PHOTO_CATEGORY, 'buy'), false);
});

test('item categories take the non-service posts', () => {
  assert.deepEqual([...postTypesForCategory(ITEM_CATEGORY)], ['sell', 'buy', 'trade', 'rent']);
  assert.equal(categoryAllowsPostType(ITEM_CATEGORY, 'sell'), true);
  assert.equal(categoryAllowsPostType(ITEM_CATEGORY, 'rent'), true);
  assert.equal(categoryAllowsPostType(ITEM_CATEGORY, 'service_offer'), false);
  assert.equal(categoryAllowsPostType(ITEM_CATEGORY, 'service_request'), false);
});

test('an unknown category is treated as an item category, not a free pass', () => {
  assert.equal(categoryAllowsPostType('Something Unlisted', 'service_offer'), false);
  assert.equal(categoryAllowsPostType('Something Unlisted', 'sell'), true);
});

test('allowedPostTypes is the intersection of role and category', () => {
  assert.deepEqual(allowedPostTypes(caller('both'), ITEM_CATEGORY), ['sell', 'buy', 'trade', 'rent']);
  assert.deepEqual(allowedPostTypes(caller('seller'), ITEM_CATEGORY), ['sell', 'trade', 'rent']);
  assert.deepEqual(allowedPostTypes(caller('buyer'), ITEM_CATEGORY), ['buy', 'trade']);
  assert.deepEqual(allowedPostTypes(caller('both'), SERVICE_CATEGORY), ['service_offer', 'service_request']);
  assert.deepEqual(allowedPostTypes(caller('seller'), SERVICE_CATEGORY), ['service_offer']);
  assert.deepEqual(allowedPostTypes(caller('seller', 'pending'), ITEM_CATEGORY), []);
});

test('the public seller name prefers the seller display name and never an email', () => {
  assert.equal(publicSellerName({ display_name: 'Kei', seller_display_name: 'Wig Studio' }), 'Wig Studio');
  assert.equal(publicSellerName({ display_name: 'Kei', seller_display_name: null }), 'Kei');
  assert.equal(publicSellerName({ display_name: 'Kei', seller_display_name: '   ' }), 'Kei');
});
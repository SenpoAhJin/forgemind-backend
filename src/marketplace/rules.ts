/**
 * Marketplace authorization rules, shared by every marketplace write path.
 *
 * WHY ONE MODULE
 * Role checks and post-type rules are the kind of thing that must not be written
 * twice. When listings were device-local there was exactly one place that could
 * create one, so a rule lived in one screen. Now the same rule has to hold for
 * the create endpoint, the appeal endpoint and, later, the offers endpoints. If
 * each of those re-derives "who may post what", they will drift and one of them
 * will be wrong. So the rules live here and the endpoints only call them.
 *
 * EVERY VALUE COMES FROM THE DATABASE
 * `verification_status`, `marketplace_role` and identity are read from the
 * `users` row of the authenticated caller. Nothing in a request body is ever
 * consulted for a permission decision, because a modified client can put
 * whatever it likes in a body.
 */

import { Request, Response } from 'express';
import { query } from '../db';
import { requireSession, type SessionUser } from '../auth/session';

export type MarketplaceRole = 'buyer' | 'seller' | 'both' | null;

export type PostType =
  | 'sell'
  | 'buy'
  | 'trade'
  | 'rent'
  | 'service_offer'
  | 'service_request';

export const POST_TYPES: readonly PostType[] = [
  'sell',
  'buy',
  'trade',
  'rent',
  'service_offer',
  'service_request',
];

/** The verified state a user must be in to read or write marketplace listings. */
export const VERIFIED_STATUS = 'verified';

/** Categories that can only carry service posts. */
export const SERVICE_ONLY_CATEGORIES: readonly string[] = [
  'Commissions & Crafting Services',
  'Photography Services',
];

/** Post types a service-only category accepts. */
const SERVICE_POST_TYPES: readonly PostType[] = ['service_offer', 'service_request'];

/** Post types an item category accepts. */
const ITEM_POST_TYPES: readonly PostType[] = ['sell', 'buy', 'trade', 'rent'];

/** Posts that put money in the seller's hand: seller or both. */
const SELLER_POST_TYPES: readonly PostType[] = ['sell', 'rent', 'service_offer'];

/** Posts that ask the market for something: buyer or both. */
const BUYER_POST_TYPES: readonly PostType[] = ['buy', 'service_request'];

export interface MarketplaceCaller extends SessionUser {
  marketplace_role: MarketplaceRole;
  seller_display_name: string | null;
}

interface RoleRow {
  marketplace_role: string | null;
  seller_display_name: string | null;
}

/** Narrowed shape of the row above: the role is either valid or null, never a free string. */
export interface MarketplaceRoleRow {
  marketplace_role: MarketplaceRole;
  seller_display_name: string | null;
}

function toRole(value: string | null): MarketplaceRole {
  return value === 'buyer' || value === 'seller' || value === 'both' ? value : null;
}

/**
 * Reads the caller's marketplace columns straight from `users`.
 *
 * Exported on its own because the checks that only need a role (a background job,
 * or a caller that already resolved the session) should not have to re-derive a
 * Request. Returns null when the row is gone rather than a fabricated "no role",
 * because null-as-no-role would produce a 403 where the truth is a 401.
 */
export async function loadMarketplaceRole(userId: string): Promise<MarketplaceRoleRow | null> {
  const rows = await query<RoleRow>(
    'SELECT marketplace_role, seller_display_name FROM users WHERE user_id = $1',
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { marketplace_role: toRole(row.marketplace_role), seller_display_name: row.seller_display_name };
}

/**
 * Session + marketplace row in one call.
 *
 * 401 when there is no live session or the user row has disappeared, and nothing
 * else: this helper only authenticates. Permission decisions belong to
 * roleAllowsPostType so that there is one implementation of them.
 */
export async function requireMarketplaceUser(
  req: Request,
  res: Response,
): Promise<MarketplaceCaller | null> {
  const session = await requireSession(req, res);
  if (!session) return null;

  const role = await loadMarketplaceRole(session.user_id);
  if (!role) {
    res.status(401).json({
      error: 'invalid_session',
      message: 'Missing, unknown, or expired session',
    });
    return null;
  }

  return {
    ...session,
    marketplace_role: role.marketplace_role,
    seller_display_name: role.seller_display_name,
  };
}

/**
 * True when the account is a verified marketplace participant.
 *
 * `verification_status` is the Head's decision and `marketplace_role` is the
 * role the account asked for; both must be right, and both come from the row.
 */
export function isVerifiedMarketplaceUser(caller: {
  verification_status: string;
  marketplace_role: MarketplaceRole;
}): boolean {
  return caller.verification_status === VERIFIED_STATUS && caller.marketplace_role !== null;
}

/**
 * True when the account is allowed to create this post type.
 *
 * A trade is open to any verified role: a seller trading stock and a buyer
 * trading something they already own are both legitimate, and the rule that
 * needs protecting is "verified", not "a seller".
 */
export function roleAllowsPostType(
  caller: { verification_status: string; marketplace_role: MarketplaceRole },
  postType: PostType,
): boolean {
  if (!isVerifiedMarketplaceUser(caller)) return false;
  const role = caller.marketplace_role;
  if (role === null) return false;

  if (postType === 'trade') return role === 'buyer' || role === 'seller' || role === 'both';
  if (SELLER_POST_TYPES.includes(postType)) return role === 'seller' || role === 'both';
  if (BUYER_POST_TYPES.includes(postType)) return role === 'buyer' || role === 'both';
  return false;
}

/** Post types the category accepts, ignoring who is asking. */
export function postTypesForCategory(category: string): readonly PostType[] {
  return SERVICE_ONLY_CATEGORIES.includes(category) ? SERVICE_POST_TYPES : ITEM_POST_TYPES;
}

/**
 * True when the post type is meaningful for the category.
 *
 * A service post in "Wigs" would be nonsense, and a wig for sale in
 * "Commissions & Crafting Services" is a miscategorised listing that the
 * relevance rule then has to guess about.
 */
export function categoryAllowsPostType(category: string, postType: PostType): boolean {
  return postTypesForCategory(category).includes(postType);
}

/** Post types this caller can post in this category. Handy for a 403 message. */
export function allowedPostTypes(
  caller: { verification_status: string; marketplace_role: MarketplaceRole },
  category: string,
): PostType[] {
  return postTypesForCategory(category).filter((postType) => roleAllowsPostType(caller, postType));
}

/** True for a Head Organizer, who may remove any listing. */
export function isHeadOrganizer(caller: { organizer_role: string | null }): boolean {
  return caller.organizer_role === 'head';
}

/**
 * True for an organizer account.
 *
 * Staff and Head accounts do not post listings and do not appear as sellers,
 * which matches the registration rule in src/marketplace/router.ts.
 */
export function isOrganizerAccount(caller: {
  is_organizer: boolean;
  organizer_role: string | null;
}): boolean {
  return caller.is_organizer || caller.organizer_role !== null;
}

/**
 * The name shown beside a listing.
 *
 * A seller may publish a seller_display_name during registration; otherwise the
 * account display name is used. Email is never a candidate, because a listing
 * is public.
 */
export function publicSellerName(caller: {
  display_name: string;
  seller_display_name: string | null;
}): string {
  const chosen = (caller.seller_display_name ?? '').trim();
  if (chosen !== '') return chosen;
  return (caller.display_name ?? '').trim();
}
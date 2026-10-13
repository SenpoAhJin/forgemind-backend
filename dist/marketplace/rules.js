"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SERVICE_ONLY_CATEGORIES = exports.VERIFIED_STATUS = exports.REMOVED_POST_TYPES = exports.POST_TYPES = void 0;
exports.loadMarketplaceRole = loadMarketplaceRole;
exports.requireMarketplaceUser = requireMarketplaceUser;
exports.isVerifiedMarketplaceUser = isVerifiedMarketplaceUser;
exports.roleAllowsPostType = roleAllowsPostType;
exports.postTypesForCategory = postTypesForCategory;
exports.categoryAllowsPostType = categoryAllowsPostType;
exports.allowedPostTypes = allowedPostTypes;
exports.isHeadOrganizer = isHeadOrganizer;
exports.isOrganizerAccount = isOrganizerAccount;
exports.publicSellerName = publicSellerName;
const db_1 = require("../db");
const session_1 = require("../auth/session");
exports.POST_TYPES = ['sell', 'trade', 'commission'];
/**
 * The post types migration 014 used to allow, kept only so the server can name
 * them in a rejection.
 *
 * A request carrying one of these gets a 400 that says the type no longer
 * exists, rather than a generic "invalid post type", because the phone still has
 * screens that offer them and a developer looking at a 400 needs to know which
 * value to stop sending.
 */
exports.REMOVED_POST_TYPES = [
    'buy',
    'rent',
    'service_offer',
    'service_request',
];
/** The verified state a user must be in to read or write marketplace listings. */
exports.VERIFIED_STATUS = 'verified';
/** Categories that can only carry commission posts. */
exports.SERVICE_ONLY_CATEGORIES = [
    'Commissions & Crafting Services',
    'Photography Services',
];
/** Post types a service-only category accepts. */
const SERVICE_POST_TYPES = ['commission'];
/** Post types an item category accepts. */
const ITEM_POST_TYPES = ['sell', 'trade'];
/**
 * Posts that put money in the maker's hand: seller or both.
 *
 * A commission is in this group, not because a commission is a sale, but because
 * it is paid work: someone is being hired, and being hired is a seller action.
 */
const SELLER_POST_TYPES = ['sell', 'commission'];
/**
 * Posts that need no seller role at all: trade.
 *
 * A trade is open to any verified role. A seller trading stock and a buyer
 * trading something they already own are both legitimate, and the rule that
 * needs protecting is "verified", not "a seller".
 */
const OPEN_POST_TYPES = ['trade'];
function toRole(value) {
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
async function loadMarketplaceRole(userId) {
    const rows = await (0, db_1.query)('SELECT marketplace_role, seller_display_name FROM users WHERE user_id = $1', [userId]);
    const row = rows[0];
    if (!row)
        return null;
    return { marketplace_role: toRole(row.marketplace_role), seller_display_name: row.seller_display_name };
}
/**
 * Session + marketplace row in one call.
 *
 * 401 when there is no live session or the user row has disappeared, and nothing
 * else: this helper only authenticates. Permission decisions belong to
 * roleAllowsPostType so that there is one implementation of them.
 */
async function requireMarketplaceUser(req, res) {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return null;
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
function isVerifiedMarketplaceUser(caller) {
    return caller.verification_status === exports.VERIFIED_STATUS && caller.marketplace_role !== null;
}
/**
 * True when the account is allowed to create this post type.
 *
 * sell and commission need seller or both: both are paid work, so both are a
 * seller action. trade needs any verified role, because a buyer trading
 * something they already own is legitimate and the rule worth protecting is
 * "verified", not "a seller".
 */
function roleAllowsPostType(caller, postType) {
    if (!isVerifiedMarketplaceUser(caller))
        return false;
    const role = caller.marketplace_role;
    if (role === null)
        return false;
    if (OPEN_POST_TYPES.includes(postType))
        return role === 'buyer' || role === 'seller' || role === 'both';
    if (SELLER_POST_TYPES.includes(postType))
        return role === 'seller' || role === 'both';
    return false;
}
/** Post types the category accepts, ignoring who is asking. */
function postTypesForCategory(category) {
    return exports.SERVICE_ONLY_CATEGORIES.includes(category) ? SERVICE_POST_TYPES : ITEM_POST_TYPES;
}
/**
 * True when the post type is meaningful for the category.
 *
 * A commission in "Wigs" would be nonsense, and a wig for sale in
 * "Commissions & Crafting Services" is a miscategorised listing that the
 * relevance rule then has to guess about.
 */
function categoryAllowsPostType(category, postType) {
    return postTypesForCategory(category).includes(postType);
}
/** Post types this caller can post in this category. Handy for a 403 message. */
function allowedPostTypes(caller, category) {
    return postTypesForCategory(category).filter((postType) => roleAllowsPostType(caller, postType));
}
/** True for a Head Organizer, who may remove any listing. */
function isHeadOrganizer(caller) {
    return caller.organizer_role === 'head';
}
/**
 * True for an organizer account.
 *
 * Staff and Head accounts do not post listings and do not appear as sellers,
 * which matches the registration rule in src/marketplace/router.ts.
 */
function isOrganizerAccount(caller) {
    return caller.is_organizer || caller.organizer_role !== null;
}
/**
 * The name shown beside a listing.
 *
 * A seller may publish a seller_display_name during registration; otherwise the
 * account display name is used. Email is never a candidate, because a listing
 * is public.
 */
function publicSellerName(caller) {
    const chosen = (caller.seller_display_name ?? '').trim();
    if (chosen !== '')
        return chosen;
    return (caller.display_name ?? '').trim();
}
//# sourceMappingURL=rules.js.map
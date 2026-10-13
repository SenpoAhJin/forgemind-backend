"use strict";
/**
 * Shared validation and row shapes for marketplace listings.
 *
 * This is the server-side authority on what a listing may contain. The mobile
 * screener is a UX pre-check that saves the user a round trip; it can be skipped
 * by a modified client, so every rule that matters is enforced again here and,
 * where it can be, by the database CHECK constraints from migration 014.
 *
 * Nothing here logs or echoes listing text back into an error message: a
 * validation message names the FIELD, not its contents, so a response body can
 * never become a copy of a rejected listing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMITS_EXTRA = exports.REMOVED_REASONS = exports.HANDOFF_METHODS = exports.DEFAULT_COMMISSION_CONDITION = exports.CONDITIONS = exports.SHARED_SEED_SELLER_IDS = void 0;
exports.isPostType = isPostType;
exports.isRemovedPostType = isRemovedPostType;
exports.legacyTransactionType = legacyTransactionType;
exports.parseListingInput = parseListingInput;
exports.toPublicListing = toPublicListing;
exports.toOwnerListing = toOwnerListing;
const moderation_1 = require("../moderation");
const rules_1 = require("./rules");
const limits_1 = require("./limits");
/**
 * The fixed demo-seller user_ids that own the SHARED seed listings.
 *
 * src/scripts/seed.ts derives a seller's user_id from a fixed email
 * (uuidv5 `user:<email>`, namespace f0e6d3a1-4b52-4c88-9e71-6a2b3c4d5e6f), so
 * these ids are stable across re-seeds and machines, while the LISTING ids are
 * not (their scheme changed between seeding runs). Every listing owned by one
 * of these users is a shared demo seed, and a real user can never be one of
 * them, so every browse and ownership query excludes their rows with a per-row
 * membership check on the seller id — never by matching listing text, and
 * without a global "source" flag.
 */
exports.SHARED_SEED_SELLER_IDS = [
    '38255f1d-df55-5b03-85b7-3699325bc140', // demo-seller@forgemind.test
    '27906419-2410-5711-b4c7-0700c19c646d', // demo-crafter@forgemind.test
    '291fa5a1-d801-576e-8b26-d76e01016836', // demo-photographer@forgemind.test
];
exports.CONDITIONS = ['new', 'like_new', 'good', 'fair', 'well_loved'];
/**
 * The condition a commission is given when the client sends none.
 *
 * A commission is work, and work has no condition: nothing has been made yet, so
 * "new" would be a claim about a state that does not exist and "well_loved"
 * would be nonsense. But the column is NOT NULL with no default, and a phone
 * that does not render a condition picker for commissions should not have to
 * know that. So the server picks the neutral middle value instead of rejecting
 * the request over a field the product does not ask for. src/marketplace/
 * rules.ts owns the rule that only service categories take commissions; this is
 * only the storage default.
 */
exports.DEFAULT_COMMISSION_CONDITION = 'good';
exports.HANDOFF_METHODS = ['meetup', 'courier', 'either'];
exports.REMOVED_REASONS = [
    'sold_elsewhere',
    'no_longer_available',
    'posted_by_mistake',
    'other',
];
/** Free-text caps. The 200 / 500 values match migration 014's column widths. */
exports.LIMITS_EXTRA = {
    tradeItemMax: 200,
    depositNoteMax: 500,
    photosMax: 8,
    photoUrlMax: 500,
    /** Whole-body budget. The global express.json() limit is 100kb; a listing is far smaller. */
    bodyMaxBytes: 32 * 1024,
    requestDeadlineMax: 10,
    titleMin: 3,
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The three listing types, re-stated here so a body cannot smuggle in a fourth. */
const CURRENT_POST_TYPES = ['sell', 'trade', 'commission'];
/**
 * True when the value is one of the three current post types.
 *
 * A value from the old six-value model is not "unknown", it is specifically
 * retired, and parseListingInput answers it differently so the caller is told
 * what to stop sending.
 */
function isPostType(value) {
    return typeof value === 'string' && CURRENT_POST_TYPES.includes(value);
}
/** True for a post type that used to exist and no longer does. */
function isRemovedPostType(value) {
    return typeof value === 'string' && rules_1.REMOVED_POST_TYPES.includes(value);
}
function optionalString(raw, max) {
    if (raw === undefined || raw === null)
        return { value: null };
    if (typeof raw !== 'string')
        return { value: null, error: 'Must be text' };
    const trimmed = raw.trim();
    if (trimmed === '')
        return { value: null };
    if (trimmed.length > max)
        return { value: null, error: `Must be at most ${max} characters` };
    return { value: trimmed };
}
/**
 * Money from the wire.
 *
 * `Number('')` and `Number(null)` are both 0, which would quietly turn an empty
 * price field into a zero-price listing, so an absent value and a bad value are
 * told apart before the number is read.
 */
function optionalMoney(raw, positive) {
    if (raw === undefined || raw === null || raw === '')
        return { value: null };
    // Reject non-number types including numeric strings
    if (typeof raw !== 'number') {
        return { value: null, error: 'Must be a number' };
    }
    const value = raw;
    if (!Number.isFinite(value))
        return { value: null, error: 'Must be a number' };
    if (positive && value <= 0)
        return { value: null, error: 'Must be greater than 0' };
    if (!positive && value < 0)
        return { value: null, error: 'Cannot be negative' };
    if (value > limits_1.MAX_AMOUNT_PHP)
        return { value: null, error: `Maximum is ₱${limits_1.MAX_AMOUNT_PHP.toLocaleString()}` };
    // Check decimal places
    const decimalPart = value.toString().split('.')[1];
    if (decimalPart && decimalPart.length > limits_1.MAX_DECIMALS) {
        return { value: null, error: `At most ${limits_1.MAX_DECIMALS} decimal places` };
    }
    return { value: Math.round(value * 100) / 100 };
}
function requiredMoney(raw) {
    const parsed = optionalMoney(raw, true);
    if (parsed.error)
        return { value: 0, error: parsed.error };
    if (parsed.value === null)
        return { value: 0, error: 'Required' };
    return { value: parsed.value };
}
function parseInteger(raw, min) {
    if (raw === undefined || raw === null || raw === '')
        return { value: null };
    const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        return { value: null, error: 'Must be a whole number' };
    }
    if (value < min)
        return { value: null, error: `Must be at least ${min}` };
    if (value > 3650)
        return { value: null, error: 'Is too large' };
    return { value };
}
function parsePhotoIds(raw) {
    if (raw === undefined || raw === null)
        return { value: [] };
    if (!Array.isArray(raw))
        return { value: [], error: 'Must be an array' };
    if (raw.length > 5) {
        return { value: [], error: 'At most 5 photos' };
    }
    const ids = [];
    const seen = new Set();
    for (const entry of raw) {
        if (typeof entry !== 'string')
            return { value: [], error: 'Each photo_id must be a string' };
        const trimmed = entry.trim();
        if (trimmed === '')
            continue;
        if (seen.has(trimmed))
            return { value: [], error: 'Duplicate photo_id' };
        seen.add(trimmed);
        ids.push(trimmed);
    }
    return { value: ids };
}
/** Legacy: parse photo_urls array for backwards compatibility */
function parsePhotos(raw) {
    if (raw === undefined || raw === null)
        return { value: [] };
    if (!Array.isArray(raw))
        return { value: [], error: 'Must be a list of links' };
    if (raw.length > exports.LIMITS_EXTRA.photosMax) {
        return { value: [], error: `At most ${exports.LIMITS_EXTRA.photosMax} photos` };
    }
    const urls = [];
    for (const entry of raw) {
        if (typeof entry !== 'string')
            return { value: [], error: 'Each photo must be a link' };
        const trimmed = entry.trim();
        if (trimmed === '')
            continue;
        if (trimmed.length > exports.LIMITS_EXTRA.photoUrlMax) {
            return { value: [], error: 'A photo link is too long' };
        }
        // Only http(s). A javascript: or file: URL in an <Image> source is a
        // client-side problem we can prevent here for free.
        if (!/^https?:\/\//i.test(trimmed)) {
            return { value: [], error: 'Each photo must be an http or https link' };
        }
        urls.push(trimmed);
    }
    return { value: urls };
}
function parseDeadline(raw) {
    if (raw === undefined || raw === null || raw === '')
        return { value: null };
    if (typeof raw !== 'string')
        return { value: null, error: 'Must be a date' };
    const trimmed = raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return { value: null, error: 'Must be a date in YYYY-MM-DD form' };
    }
    const parsed = Date.parse(`${trimmed}T00:00:00Z`);
    if (Number.isNaN(parsed))
        return { value: null, error: 'Is not a real date' };
    return { value: trimmed };
}
/**
 * The legacy `transaction_type` value written alongside post_type.
 *
 * The column is kept so older reads keep working, and its own CHECK is still in
 * force, so the value has to come from ('buy', 'trade', 'both'). 'buy' is the
 * legacy word for "a priced listing other people buy", which is what sell is.
 * Trade is its own value. A commission has no legacy equivalent, so it takes
 * 'both', the legacy bucket for "not a plain priced sale".
 */
function legacyTransactionType(postType) {
    if (postType === 'trade')
        return 'trade';
    if (postType === 'sell')
        return 'buy';
    return 'both';
}
/**
 * Per-post-type money requirements, re-stated here on purpose.
 *
 * These duplicate the migration 016 CHECK constraints deliberately: the database
 * is the last line of defence, but a constraint violation surfaces as a raw
 * PostgreSQL error, which would be mapped to a 500. Rejecting the request here
 * means the caller gets a 400 that names the field.
 *
 *   sell        price > 0
 *   commission  rate > 0, the starting rate
 *   trade       no money field at all, it has two items
 *
 * A trade's estimated value is parsed but never required, so a swap can be listed
 * before either side agrees on what it is worth.
 */
const MONEY_RULES = {
    sell: { required: 'price', message: 'A price is required for a sell post' },
    commission: { required: 'rate', message: 'A starting rate is required for a commission' },
    trade: { required: null, message: 'A trade post needs both items' },
};
/**
 * Validates a create request.
 *
 * `category_id` is resolved by the caller from permitted_categories first, so an
 * unknown or inactive category is a 400 before any of this runs.
 */
function parseListingInput(body, context) {
    if (!isRecord(body)) {
        return { ok: false, message: 'Request body must be a JSON object', fields: {} };
    }
    let size = 0;
    try {
        size = JSON.stringify(body).length;
    }
    catch {
        return { ok: false, message: 'Request body could not be read', fields: {} };
    }
    if (size > exports.LIMITS_EXTRA.bodyMaxBytes) {
        return {
            ok: false,
            message: `A listing request may not exceed ${Math.floor(exports.LIMITS_EXTRA.bodyMaxBytes / 1024)}kb`,
            fields: {},
        };
    }
    const fields = {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length === 0)
        fields.title = 'Enter a title';
    else if (title.length > moderation_1.LIMITS.titleMax)
        fields.title = `At most ${moderation_1.LIMITS.titleMax} characters`;
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length === 0)
        fields.description = 'Enter a description';
    else if (description.length > moderation_1.LIMITS.descriptionMax) {
        fields.description = `At most ${moderation_1.LIMITS.descriptionMax} characters`;
    }
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    if (category === '')
        fields.category = 'Choose a category';
    const postTypeRaw = body.post_type;
    if (isRemovedPostType(postTypeRaw)) {
        // Named explicitly rather than folded into "choose what kind of post this is",
        // because the phone still offers these four and a caller reading a 400 has to
        // be able to tell "you sent a retired value" from "you sent nonsense".
        return {
            ok: false,
            message: 'That listing type no longer exists',
            fields: {
                post_type: `The marketplace has three types: ${rules_1.POST_TYPES.join(', ')}. "${String(postTypeRaw)}" was removed.`,
            },
        };
    }
    if (!isPostType(postTypeRaw)) {
        fields.post_type = 'Choose sell, trade or commission';
        return { ok: false, message: 'One or more fields are invalid', fields };
    }
    const postType = postTypeRaw;
    const conditionRaw = typeof body.condition === 'string' ? body.condition.trim() : '';
    let condition = exports.CONDITIONS.includes(conditionRaw)
        ? conditionRaw
        : null;
    if (condition === null) {
        // A commission is work that has not been done yet, so the product has no
        // condition to ask for. Absent means the storage default rather than an
        // error, because a phone with no condition picker on its commission form
        // should not have to know the column is NOT NULL. A condition that WAS sent
        // and is not a real value is still a mistake, and says so.
        const absent = body.condition === undefined || body.condition === null || conditionRaw === '';
        if (postType === 'commission' && absent) {
            condition = exports.DEFAULT_COMMISSION_CONDITION;
        }
        else {
            fields.condition = 'Choose a condition';
        }
    }
    // The one required money field for this post type, if it has one.
    const moneyRule = MONEY_RULES[postType];
    const requiredKey = moneyRule.required;
    const required = requiredKey === null ? { value: 0 } : requiredMoney(body[requiredKey]);
    if ('error' in required && required.error)
        fields[String(requiredKey)] = required.error;
    const requiredValue = 'value' in required ? required.value : 0;
    // The other two money fields are optional everywhere; a stray non-negative
    // number is accepted and simply ignored rather than rejected.
    const budget = optionalMoney(body.budget, false);
    if (budget.error)
        fields.budget = budget.error;
    const rate = optionalMoney(body.rate, false);
    if (rate.error)
        fields.rate = rate.error;
    const rentalFee = optionalMoney(body.rental_fee, false);
    if (rentalFee.error)
        fields.rental_fee = rentalFee.error;
    const estimatedValue = optionalMoney(body.trade_estimated_value, false);
    if (estimatedValue.error)
        fields.trade_estimated_value = estimatedValue.error;
    const period = parseInteger(body.rental_period_days, 1);
    if (period.error)
        fields.rental_period_days = period.error;
    const offered = optionalString(body.trade_offered_item, exports.LIMITS_EXTRA.tradeItemMax);
    if (offered.error)
        fields.trade_offered_item = offered.error;
    const wanted = optionalString(body.trade_wanted_item, exports.LIMITS_EXTRA.tradeItemMax);
    if (wanted.error)
        fields.trade_wanted_item = wanted.error;
    // A trade without both items is not a trade, whatever the money fields say.
    if (postType === 'trade') {
        if (!offered.value)
            fields.trade_offered_item = 'Describe what you are offering';
        if (!wanted.value)
            fields.trade_wanted_item = 'Describe what you want in return';
    }
    const deposit = optionalString(body.deposit_note, exports.LIMITS_EXTRA.depositNoteMax);
    if (deposit.error)
        fields.deposit_note = deposit.error;
    const deadline = parseDeadline(body.request_deadline);
    if (deadline.error)
        fields.request_deadline = deadline.error;
    let handoff = null;
    if (body.handoff_method !== undefined && body.handoff_method !== null && body.handoff_method !== '') {
        const raw = typeof body.handoff_method === 'string' ? body.handoff_method : '';
        if (!exports.HANDOFF_METHODS.includes(raw)) {
            fields.handoff_method = 'Choose meetup, courier or either';
        }
        else {
            handoff = raw;
        }
    }
    const photos = parsePhotoIds(body.photo_ids);
    if (photos.error)
        fields.photo_ids = photos.error;
    if (Object.keys(fields).length > 0) {
        return { ok: false, message: 'One or more fields are invalid', fields };
    }
    // price is NOT NULL in the schema, so a type whose money field is something
    // else stores 0 there. listings_post_type_money is what enforces the rule that
    // actually matters.
    const price = postType === 'sell' ? requiredValue : 0;
    return {
        ok: true,
        value: {
            title,
            description,
            category,
            category_id: context.category_id,
            post_type: postType,
            price,
            // budget and rental_fee belong to the retired types. They are still parsed
            // so a stale client sending one gets a validation error naming the field
            // rather than having it silently dropped, but they are never stored.
            budget: budget.value,
            rate: postType === 'commission' ? requiredValue : rate.value,
            rental_fee: rentalFee.value,
            rental_period_days: period.value,
            deposit_note: deposit.value,
            trade_offered_item: offered.value,
            trade_wanted_item: wanted.value,
            trade_estimated_value: estimatedValue.value,
            request_deadline: deadline.value,
            handoff_method: handoff,
            open_to_trade: body.open_to_trade === true,
            condition: condition,
            photo_ids: photos.value,
        },
    };
}
function money(value) {
    if (value === null)
        return null;
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function iso(value) {
    if (value === null)
        return null;
    return value instanceof Date ? value.toISOString() : String(value);
}
function dateOnly(value) {
    const asIso = iso(value);
    return asIso === null ? null : asIso.slice(0, 10);
}
/**
 * The public shape of a listing.
 *
 * `screening_reason` is deliberately absent. It is the server's explanation for
 * a block, it can describe exactly which rule fired, and another user's block
 * reason is none of this caller's business. The owner reads it from
 * /listings/mine, where it belongs.
 *
 * `seller_email` is absent for the same reason and for a stricter one: another
 * user's email address is never sent to a client. What a client does get is
 * `seller_user_id` (the id, for matching) and `seller_name` (the name the
 * seller chose at registration, for display), plus `is_owner`, which is the
 * only trustworthy answer to "is this my own listing". The client must not
 * derive ownership by comparing addresses.
 */
function toPublicListing(row, callerUserId, photos = []) {
    // For non-active listings, only owner sees photos
    const isOwner = callerUserId != null && row.seller_user_id === callerUserId;
    const isActive = row.listing_status === 'active';
    const visiblePhotos = isActive || isOwner ? photos : [];
    return {
        id: row.listing_id,
        title: row.item_title,
        description: row.item_description,
        category: row.category_name,
        post_type: row.post_type,
        transaction_type: row.transaction_type,
        price: money(row.price),
        budget: money(row.budget),
        rate: money(row.rate),
        rental_fee: money(row.rental_fee),
        rental_period_days: row.rental_period_days,
        deposit_note: row.deposit_note,
        trade_offered_item: row.trade_offered_item,
        trade_wanted_item: row.trade_wanted_item,
        trade_estimated_value: money(row.trade_estimated_value),
        request_deadline: dateOnly(row.request_deadline),
        handoff_method: row.handoff_method,
        open_to_trade: row.open_to_trade,
        condition: row.condition,
        photos: visiblePhotos,
        status: row.listing_status,
        screening_result: row.screening_result,
        seller_user_id: row.seller_user_id,
        seller_name: row.seller_name,
        seller_verified: row.seller_verified,
        is_owner: isOwner,
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
    };
}
/**
 * The owner shape of a listing: the public fields plus the moderation and appeal
 * state, which only the owner (and a Head, through the users router) may read.
 * Every row here belongs to the caller, so is_owner is always true.
 */
function toOwnerListing(row, photos = []) {
    return {
        ...toPublicListing(row, row.seller_user_id, photos),
        screening_reason: row.screening_reason,
        appeal_status: row.appeal_status,
        appeal_message: row.appeal_message,
        screener_version: row.screener_version,
        removed_at: iso(row.removed_at),
        removed_reason: row.removed_reason,
    };
}
//# sourceMappingURL=listings.js.map
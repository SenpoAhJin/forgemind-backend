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

import { LIMITS } from '../moderation';
import { POST_TYPES, REMOVED_POST_TYPES, type PostType } from './rules';

export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'well_loved'] as const;
export type Condition = (typeof CONDITIONS)[number];

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
export const DEFAULT_COMMISSION_CONDITION: Condition = 'good';

export const HANDOFF_METHODS = ['meetup', 'courier', 'either'] as const;
export type HandoffMethod = (typeof HANDOFF_METHODS)[number];

export const REMOVED_REASONS = [
  'sold_elsewhere',
  'no_longer_available',
  'posted_by_mistake',
  'other',
] as const;
export type RemovedReason = (typeof REMOVED_REASONS)[number];

/** Free-text caps. The 200 / 500 values match migration 014's column widths. */
export const LIMITS_EXTRA = {
  tradeItemMax: 200,
  depositNoteMax: 500,
  photosMax: 8,
  photoUrlMax: 500,
  /** Whole-body budget. The global express.json() limit is 100kb; a listing is far smaller. */
  bodyMaxBytes: 32 * 1024,
  requestDeadlineMax: 10,
  titleMin: 3,
} as const;

export interface ListingInput {
  title: string;
  description: string;
  category: string;
  category_id: string;
  post_type: PostType;
  price: number;
  budget: number | null;
  rate: number | null;
  rental_fee: number | null;
  rental_period_days: number | null;
  deposit_note: string | null;
  trade_offered_item: string | null;
  trade_wanted_item: string | null;
  trade_estimated_value: number | null;
  request_deadline: string | null;
  handoff_method: HandoffMethod | null;
  open_to_trade: boolean;
  condition: Condition;
  photo_urls: string[];
}

export type ParseFailure = { ok: false; message: string; fields: Record<string, string> };
export type ParseResult = { ok: true; value: ListingInput } | ParseFailure;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The three listing types, re-stated here so a body cannot smuggle in a fourth. */
const CURRENT_POST_TYPES: readonly string[] = ['sell', 'trade', 'commission'];

/**
 * True when the value is one of the three current post types.
 *
 * A value from the old six-value model is not "unknown", it is specifically
 * retired, and parseListingInput answers it differently so the caller is told
 * what to stop sending.
 */
export function isPostType(value: unknown): value is PostType {
  return typeof value === 'string' && CURRENT_POST_TYPES.includes(value);
}

/** True for a post type that used to exist and no longer does. */
export function isRemovedPostType(value: unknown): boolean {
  return typeof value === 'string' && REMOVED_POST_TYPES.includes(value);
}

function optionalString(
  raw: unknown,
  max: number,
): { value: string | null; error?: string } {
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== 'string') return { value: null, error: 'Must be text' };
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null };
  if (trimmed.length > max) return { value: null, error: `Must be at most ${max} characters` };
  return { value: trimmed };
}

/**
 * Money from the wire.
 *
 * `Number('')` and `Number(null)` are both 0, which would quietly turn an empty
 * price field into a zero-price listing, so an absent value and a bad value are
 * told apart before the number is read.
 */
function optionalMoney(raw: unknown, positive: boolean): { value: number | null; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value)) return { value: null, error: 'Must be a number' };
  if (positive && value <= 0) return { value: null, error: 'Must be greater than 0' };
  if (!positive && value < 0) return { value: null, error: 'Cannot be negative' };
  if (value > 99_999_999) return { value: null, error: 'Is too large' };
  return { value: Math.round(value * 100) / 100 };
}

function requiredMoney(raw: unknown): { value: number; error?: string } {
  const parsed = optionalMoney(raw, true);
  if (parsed.error) return { value: 0, error: parsed.error };
  if (parsed.value === null) return { value: 0, error: 'Required' };
  return { value: parsed.value };
}

function parseInteger(raw: unknown, min: number): { value: number | null; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { value: null, error: 'Must be a whole number' };
  }
  if (value < min) return { value: null, error: `Must be at least ${min}` };
  if (value > 3650) return { value: null, error: 'Is too large' };
  return { value };
}

function parsePhotos(raw: unknown): { value: string[]; error?: string } {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { value: [], error: 'Must be a list of links' };
  if (raw.length > LIMITS_EXTRA.photosMax) {
    return { value: [], error: `At most ${LIMITS_EXTRA.photosMax} photos` };
  }
  const urls: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return { value: [], error: 'Each photo must be a link' };
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    if (trimmed.length > LIMITS_EXTRA.photoUrlMax) {
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

function parseDeadline(raw: unknown): { value: string | null; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { value: null };
  if (typeof raw !== 'string') return { value: null, error: 'Must be a date' };
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { value: null, error: 'Must be a date in YYYY-MM-DD form' };
  }
  const parsed = Date.parse(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed)) return { value: null, error: 'Is not a real date' };
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
export function legacyTransactionType(postType: PostType): 'buy' | 'trade' | 'both' {
  if (postType === 'trade') return 'trade';
  if (postType === 'sell') return 'buy';
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
const MONEY_RULES: Record<PostType, { required: keyof ListingInput | null; message: string }> = {
  sell: { required: 'price', message: 'A price is required for a sell post' },
  commission: { required: 'rate', message: 'A starting rate is required for a commission' },
  trade: { required: null, message: 'A trade post needs both items' },
};

export interface ParseContext {
  category_id: string;
}

/**
 * Validates a create request.
 *
 * `category_id` is resolved by the caller from permitted_categories first, so an
 * unknown or inactive category is a 400 before any of this runs.
 */
export function parseListingInput(body: unknown, context: ParseContext): ParseResult {
  if (!isRecord(body)) {
    return { ok: false, message: 'Request body must be a JSON object', fields: {} };
  }

  let size = 0;
  try {
    size = JSON.stringify(body).length;
  } catch {
    return { ok: false, message: 'Request body could not be read', fields: {} };
  }
  if (size > LIMITS_EXTRA.bodyMaxBytes) {
    return {
      ok: false,
      message: `A listing request may not exceed ${Math.floor(LIMITS_EXTRA.bodyMaxBytes / 1024)}kb`,
      fields: {},
    };
  }

  const fields: Record<string, string> = {};

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length === 0) fields.title = 'Enter a title';
  else if (title.length > LIMITS.titleMax) fields.title = `At most ${LIMITS.titleMax} characters`;

  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (description.length === 0) fields.description = 'Enter a description';
  else if (description.length > LIMITS.descriptionMax) {
    fields.description = `At most ${LIMITS.descriptionMax} characters`;
  }

  const category = typeof body.category === 'string' ? body.category.trim() : '';
  if (category === '') fields.category = 'Choose a category';

  const postTypeRaw = body.post_type;
  if (isRemovedPostType(postTypeRaw)) {
    // Named explicitly rather than folded into "choose what kind of post this is",
    // because the phone still offers these four and a caller reading a 400 has to
    // be able to tell "you sent a retired value" from "you sent nonsense".
    return {
      ok: false,
      message: 'That listing type no longer exists',
      fields: {
        post_type: `The marketplace has three types: ${POST_TYPES.join(', ')}. "${String(postTypeRaw)}" was removed.`,
      },
    };
  }
  if (!isPostType(postTypeRaw)) {
    fields.post_type = 'Choose sell, trade or commission';
    return { ok: false, message: 'One or more fields are invalid', fields };
  }
  const postType: PostType = postTypeRaw;

  const conditionRaw = typeof body.condition === 'string' ? body.condition.trim() : '';
  let condition: Condition | null = (CONDITIONS as readonly string[]).includes(conditionRaw)
    ? (conditionRaw as Condition)
    : null;
  if (condition === null) {
    // A commission is work that has not been done yet, so the product has no
    // condition to ask for. Absent means the storage default rather than an
    // error, because a phone with no condition picker on its commission form
    // should not have to know the column is NOT NULL. A condition that WAS sent
    // and is not a real value is still a mistake, and says so.
    const absent = body.condition === undefined || body.condition === null || conditionRaw === '';
    if (postType === 'commission' && absent) {
      condition = DEFAULT_COMMISSION_CONDITION;
    } else {
      fields.condition = 'Choose a condition';
    }
  }

  // The one required money field for this post type, if it has one.
  const moneyRule = MONEY_RULES[postType];
  const requiredKey = moneyRule.required;
  const required = requiredKey === null ? { value: 0 } : requiredMoney(body[requiredKey]);
  if ('error' in required && required.error) fields[String(requiredKey)] = required.error;
  const requiredValue = 'value' in required ? required.value : 0;

  // The other two money fields are optional everywhere; a stray non-negative
  // number is accepted and simply ignored rather than rejected.
  const budget = optionalMoney(body.budget, false);
  if (budget.error) fields.budget = budget.error;
  const rate = optionalMoney(body.rate, false);
  if (rate.error) fields.rate = rate.error;
  const rentalFee = optionalMoney(body.rental_fee, false);
  if (rentalFee.error) fields.rental_fee = rentalFee.error;
  const estimatedValue = optionalMoney(body.trade_estimated_value, false);
  if (estimatedValue.error) fields.trade_estimated_value = estimatedValue.error;

  const period = parseInteger(body.rental_period_days, 1);
  if (period.error) fields.rental_period_days = period.error;

  const offered = optionalString(body.trade_offered_item, LIMITS_EXTRA.tradeItemMax);
  if (offered.error) fields.trade_offered_item = offered.error;
  const wanted = optionalString(body.trade_wanted_item, LIMITS_EXTRA.tradeItemMax);
  if (wanted.error) fields.trade_wanted_item = wanted.error;

  // A trade without both items is not a trade, whatever the money fields say.
  if (postType === 'trade') {
    if (!offered.value) fields.trade_offered_item = 'Describe what you are offering';
    if (!wanted.value) fields.trade_wanted_item = 'Describe what you want in return';
  }

  const deposit = optionalString(body.deposit_note, LIMITS_EXTRA.depositNoteMax);
  if (deposit.error) fields.deposit_note = deposit.error;

  const deadline = parseDeadline(body.request_deadline);
  if (deadline.error) fields.request_deadline = deadline.error;

  let handoff: HandoffMethod | null = null;
  if (body.handoff_method !== undefined && body.handoff_method !== null && body.handoff_method !== '') {
    const raw = typeof body.handoff_method === 'string' ? body.handoff_method : '';
    if (!(HANDOFF_METHODS as readonly string[]).includes(raw)) {
      fields.handoff_method = 'Choose meetup, courier or either';
    } else {
      handoff = raw as HandoffMethod;
    }
  }

  const photos = parsePhotos(body.photos ?? body.photo_urls);
  if (photos.error) fields.photos = photos.error;

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
      condition: condition as Condition,
      photo_urls: photos.value,
    },
  };
}

export interface ListingRow {
  listing_id: string;
  seller_user_id: string;
  seller_name: string | null;
  seller_verified: boolean;
  category_name: string;
  item_title: string;
  item_description: string;
  transaction_type: string;
  post_type: string;
  price: string | number | null;
  budget: string | number | null;
  rate: string | number | null;
  rental_fee: string | number | null;
  rental_period_days: number | null;
  deposit_note: string | null;
  trade_offered_item: string | null;
  trade_wanted_item: string | null;
  trade_estimated_value: string | number | null;
  request_deadline: Date | string | null;
  handoff_method: string | null;
  open_to_trade: boolean;
  condition: string;
  photo_urls: string[] | null;
  listing_status: string;
  screening_result: string;
  screening_reason: string | null;
  appeal_status: string;
  appeal_message: string | null;
  screener_version: number | null;
  removed_at: Date | string | null;
  removed_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function money(value: string | number | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function dateOnly(value: Date | string | null): string | null {
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
export function toPublicListing(
  row: ListingRow,
  callerUserId?: string | null,
): Record<string, unknown> {
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
    photos: row.photo_urls ?? [],
    status: row.listing_status,
    screening_result: row.screening_result,
    seller_user_id: row.seller_user_id,
    seller_name: row.seller_name,
    seller_verified: row.seller_verified,
    is_owner: callerUserId != null && row.seller_user_id === callerUserId,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

/**
 * The owner shape of a listing: the public fields plus the moderation and appeal
 * state, which only the owner (and a Head, through the users router) may read.
 * Every row here belongs to the caller, so is_owner is always true.
 */
export function toOwnerListing(row: ListingRow): Record<string, unknown> {
  return {
    ...toPublicListing(row, row.seller_user_id),
    screening_reason: row.screening_reason,
    appeal_status: row.appeal_status,
    appeal_message: row.appeal_message,
    screener_version: row.screener_version,
    removed_at: iso(row.removed_at),
    removed_reason: row.removed_reason,
  };
}
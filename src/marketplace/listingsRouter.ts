/**
 * Marketplace listing routes, mounted under /marketplace by ./router.ts.
 *
 * WHY THIS IS A SEPARATE FILE
 * ./router.ts already carries registration and the pre-publish check. The
 * listing endpoints are a different job (browse, create, remove, appeal) and
 * keeping them here stops one file from growing past what anyone can review. The
 * URL space is unchanged: marketplaceRouter.use(listingsRouter) puts every route
 * below at /marketplace/...
 *
 * ENDPOINTS
 *   GET  /marketplace/listings            browse, active listings only
 *   GET  /marketplace/listings/mine       the caller's listings, every status
 *   POST /marketplace/listings            create (moderated)
 *   POST /marketplace/listings/:id/sold   owner marks it sold
 *   POST /marketplace/listings/:id/remove owner (or a Head) takes it down
 *   POST /marketplace/listings/:id/appeal owner appeals a block
 *
 * THE RULES THAT MATTER
 * - Identity, verification status and marketplace role come from the `users` row
 *   of the authenticated caller. A body field claiming to be a seller id, a role
 *   or a verification state is ignored, because a modified client can send
 *   anything.
 * - Server validation is the authority. The mobile screener is a UX pre-check
 *   and is not trusted: every listing is screened again here through
 *   checkListingContent and checkListingQuality before it is stored.
 * - A listing that fails either content gate is refused with 422 and no row is
 *   written. Nothing is stored means nothing for a seller to appeal and nothing
 *   for a later cleanup to find, which is the point: junk and unsafe text should
 *   never become a row. Rows that already exist and are held later by a
 *   rescreen are a different case and stay appealable.
 * - A listing the same seller already has on the marketplace, word for word, is
 *   a copy-paste duplicate and is refused with 409 before the insert.
 * - No listing text is written to a log, an error message or any other listing's
 *   response.
 */

import { Request, Response, Router, NextFunction } from 'express';
import { query } from '../db';
import { classifyDbError, generateRequestId } from '../db/errors';
import {
  categoryAllowsPostType,
  isHeadOrganizer,
  isVerifiedMarketplaceUser,
  postTypesForCategory,
  requireMarketplaceUser,
  roleAllowsPostType,
  type MarketplaceCaller,
} from './rules';
import {
  isPostType,
  legacyTransactionType,
  parseListingInput,
  toOwnerListing,
  toPublicListing,
  SHARED_SEED_SELLER_IDS,
  REMOVED_REASONS,
  type ListingRow,
} from './listings';
import { checkListingContent, violationSummary } from './screener';
import { assertCanPost, recordViolation } from './strikes';
import { checkListingQuality, QUALITY_MESSAGE } from './quality';
import { LIMITS } from '../moderation';
import { PRICE_OUTLIER_PHP } from './limits';

type NextPenalty = 'lock_10m' | 'lock_7d' | 'ban';

export const listingsRouter = Router();

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Browse default and ceiling. */
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** Max photos/messages are enforced in ./listings; this is the appeal cap. */
const APPEAL_MESSAGE_MAX = LIMITS.descriptionMax;

/**
 * The one message a refused create returns.
 *
 * Says what to do and not which gate fired, for the same reason
 * BLOCKED_REASON in ./screener does: the specific rule would turn the endpoint
 * into a probe. The caller that needs the field back is the seller, and the
 * seller already has it from POST /marketplace/listings/check, which this
 * screen runs before every save.
 */
export const CREATE_REJECTED_MESSAGE =
  'This listing could not be published. Please review the listing guidelines and try again.';

/**
 * Statuses a repeated title collides with.
 *
 * Active and blocked only. 'sold' and 'cancelled' are finished: an item that
 * sold, or that the seller took down, is exactly the item they are allowed to
 * list again, so re-posting it is not a duplicate.
 */
const DUPLICATE_STATUSES: readonly string[] = ['active', 'blocked'];

/**
 * Title form used for the duplicate match: trimmed, internal whitespace
 * collapsed to single spaces, lowercased.
 *
 * The same three steps SQL applies to `item_title`, so a title typed with two
 * spaces matches one stored with one and neither side can disagree about what
 * "the same title" means.
 */
function normaliseForDuplicate(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Columns read for every listing response.
 *
 * `seller_name` prefers the seller display name chosen at registration and falls
 * back to the account display name, then to a neutral label. Email is not in this
 * expression and must never be added: a listing is public.
 */
const LISTING_COLUMNS = `
  l.listing_id, l.seller_user_id, l.item_title, l.item_description,
  l.transaction_type, l.post_type, l.price, l.budget, l.rate, l.rental_fee,
  l.rental_period_days, l.deposit_note, l.trade_offered_item, l.trade_wanted_item,
  l.trade_estimated_value, l.request_deadline, l.handoff_method, l.open_to_trade,
  l.condition, l.photo_urls, l.listing_status, l.screening_result, l.screening_reason,
  l.appeal_status, l.appeal_message, l.screener_version, l.removed_at,
  l.removed_reason, l.created_at, l.updated_at,
  pc.category_name,
  COALESCE(NULLIF(BTRIM(u.display_name), ''), NULLIF(BTRIM(u.seller_display_name), ''),
           'Cosplayer') AS seller_name,
  (u.verification_status = 'verified') AS seller_verified
`;

const LISTING_FROM = `
  FROM listings l
  JOIN permitted_categories pc ON pc.category_id = l.category_id
  JOIN users u ON u.user_id = l.seller_user_id
`;

/**
 * PostgreSQL raises 22P02 (invalid_text_representation) for a malformed uuid,
 * which would surface as a 500. A bad path parameter is the caller's mistake, so
 * it is answered with a 400 before the query runs.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readId(req: Request, res: Response): string | null {
  const raw = req.params.id;
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) {
    res.status(400).json({ error: 'validation_error', message: 'That listing id is not valid' });
    return null;
  }
  return raw;
}

/**
 * Logs the classification and answers 503 or 500. Never the request body.
 *
 * Only the classification, the request id and, when PostgreSQL named one, the
 * CONSTRAINT are logged. A raw driver message is never logged here: the DETAIL
 * line of a CHECK violation repeats the whole row, and a row is a listing, so
 * writing it to a log would put listing text in a place the screener exists to
 * keep it out of.
 */
function failDb(res: Response, err: unknown, route: string): void {
  const classification = classifyDbError(err);
  const requestId = generateRequestId();
  const constraint = (err as { constraint?: unknown }).constraint;
  const constraintSuffix =
    typeof constraint === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(constraint)
      ? ` constraint=${constraint}`
      : '';
  console.error(
    `[marketplace:${route}] error [${requestId}]: ${classification.logReason}${constraintSuffix}`,
  );
  res.status(classification.httpStatus).json({
    error: classification.errorCode,
    message: classification.clientMessage,
  });
}

/**
 * Per-user create quota, in memory.
 *
 * Deliberately no new dependency, and deliberately per process: this exists to
 * stop one client from filling the listings table, not to meter a plan. A
 * multi-instance deploy would enforce it per instance, which is acceptable for
 * that purpose. Counters are swept so a long-running process cannot leak them.
 */
const CREATE_RATE_LIMIT = 20;
const CREATE_RATE_WINDOW_MS = 60 * 60_000;

interface RateBucket {
  count: number;
  windowStart: number;
}

const createBuckets = new Map<string, RateBucket>();

function consumeCreateQuota(userId: string): boolean {
  const now = Date.now();
  const bucket = createBuckets.get(userId);
  if (!bucket || now - bucket.windowStart >= CREATE_RATE_WINDOW_MS) {
    createBuckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= CREATE_RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

const createSweep = setInterval(() => {
  const cutoff = Date.now() - CREATE_RATE_WINDOW_MS;
  for (const [key, bucket] of createBuckets) {
    if (bucket.windowStart < cutoff) createBuckets.delete(key);
  }
}, CREATE_RATE_WINDOW_MS);
createSweep.unref();

/** 403 unless the caller is a verified marketplace participant. */
function requireVerified(caller: MarketplaceCaller, res: Response): boolean {
  if (isVerifiedMarketplaceUser(caller)) return true;
  res.status(403).json({
    error: 'forbidden',
    message: 'Your Marketplace access is not verified yet',
  });
  return false;
}

function parseLimit(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 1) return null;
  return Math.min(value, MAX_LIMIT);
}

/**
 * Cursor encoding.
 *
 * created_at alone is not unique, so a cursor carries the id too and the query
 * compares the pair. That makes paging stable when two listings share a
 * timestamp, which a same-second create burst does.
 */
function encodeCursor(row: { created_at: Date | string; listing_id: string }): string {
  const created =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return Buffer.from(`${created}|${row.listing_id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: unknown): { created: string; id: string } | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') return 'invalid';
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return 'invalid';
  }
  const split = decoded.indexOf('|');
  if (split === -1) return 'invalid';
  const created = decoded.slice(0, split);
  const id = decoded.slice(split + 1);
  if (Number.isNaN(Date.parse(created)) || !UUID_PATTERN.test(id)) return 'invalid';
  return { created, id };
}

/**
 * GET /marketplace/listings
 *
 * The browse feed. Active, screened listings from every seller, newest first.
 * Blocked, sold and cancelled rows are filtered out in SQL rather than in the
 * response, so they cannot leak through a bug in a mapping.
 */
/**
 * GET /marketplace/me/status
 * 
 * Returns the caller's posting status: lock time, ban flag, and next penalty.
 * No strike counts or reasons exposed.
 */
listingsRouter.get(
  '/me/status',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;

    const statusRows = await query<{
      posting_locked_until: Date | null;
      banned_at: Date | null;
      strike_count: number;
    }>(
      `SELECT posting_locked_until, banned_at, strike_count
       FROM marketplace_user_status
       WHERE user_id = $1`,
      [caller.user_id]
    );

    if (statusRows.length === 0) {
      res.status(200).json({
        posting_locked_until: null,
        banned: false,
        next_penalty: 'lock_10m',
      });
      return;
    }

    const status = statusRows[0];
    const banned = !!status.banned_at;
    
    // Lazy expiry: past locks are ignored
    const lockedUntil = status.posting_locked_until && new Date(status.posting_locked_until) > new Date()
      ? status.posting_locked_until
      : null;

    // Compute next penalty from current strike count
    let nextPenalty: NextPenalty = 'lock_10m';
    if (status.strike_count >= 5) {
      nextPenalty = 'ban';
    } else if (status.strike_count === 4) {
      nextPenalty = 'lock_7d';
    }

    res.status(200).json({
      posting_locked_until: lockedUntil ? new Date(lockedUntil).toISOString() : null,
      banned,
      next_penalty: nextPenalty,
    });
  })
);

listingsRouter.get(
  '/listings',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;
    if (!requireVerified(caller, res)) return;

    try {
      const limit = parseLimit(req.query.limit);
      if (limit === null) {
        res.status(400).json({
          error: 'validation_error',
          message: `limit must be a whole number between 1 and ${MAX_LIMIT}`,
        });
        return;
      }

      const offsetRaw = req.query.offset;
      let offset = 0;
      if (offsetRaw !== undefined && offsetRaw !== null && offsetRaw !== '') {
        const parsed = Number(String(offsetRaw).trim());
        if (!Number.isInteger(parsed) || parsed < 0) {
          res.status(400).json({ error: 'validation_error', message: 'offset must be 0 or more' });
          return;
        }
        offset = parsed;
      }

      const cursor = decodeCursor(req.query.cursor);
      if (cursor === 'invalid') {
        res.status(400).json({
          error: 'validation_error',
          message: 'cursor is not valid. Start again without a cursor.',
        });
        return;
      }

      const params: unknown[] = [];
      const where: string[] = [
        "l.listing_status = 'active'",
        "l.screening_result = 'passed'",
        'l.removed_at IS NULL',
      ];

      const category = typeof req.query.category === 'string' ? req.query.category.trim() : '';
      if (category !== '') {
        params.push(category);
        where.push(`pc.category_name = $${params.length}`);
      }

      const postType = typeof req.query.post_type === 'string' ? req.query.post_type.trim() : '';
      if (postType !== '') {
        if (!isPostType(postType)) {
          res.status(400).json({
            error: 'validation_error',
            message: 'post_type is not a known post type',
          });
          return;
        }
        params.push(postType);
        where.push(`l.post_type = $${params.length}`);
      }

      if (cursor) {
        // (created_at, listing_id) strictly older than the cursor pair.
        params.push(cursor.created, cursor.id);
        where.push(`(l.created_at, l.listing_id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }

      // The shared/demo seed rows never belong in a real browse result.
      const seedSellerParam = params.length + 1;
      params.push(Array.from(SHARED_SEED_SELLER_IDS));
      where.push(`NOT (l.seller_user_id = ANY($${seedSellerParam}::uuid[]))`);

      const limitParam = params.length + 1;
      params.push(limit);

      const offsetClause = cursor ? '' : ` OFFSET ${offset}`;
      const rows = await query<ListingRow>(
        `SELECT ${LISTING_COLUMNS} ${LISTING_FROM}
          WHERE ${where.join(' AND ')}
          ORDER BY l.created_at DESC, l.listing_id DESC
          LIMIT $${limitParam}${offsetClause}`,
        params,
      );

      const last = rows[rows.length - 1];
      res.status(200).json({
        listings: rows.map(row => toPublicListing(row, caller.user_id)),
        count: rows.length,
        limit,
        next_cursor: rows.length === limit && last ? encodeCursor(last) : null,
      });
    } catch (err) {
      failDb(res, err, 'listings');
    }
  }),
);

/**
 * GET /marketplace/listings/mine
 *
 * Every listing the caller owns, in every status, including blocked ones with
 * the screening reason and the appeal fields. This is the only place a seller
 * learns why a listing was blocked.
 */
listingsRouter.get(
  '/listings/mine',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;

    try {
      const limit = parseLimit(req.query.limit);
      if (limit === null) {
        res.status(400).json({
          error: 'validation_error',
          message: `limit must be a whole number between 1 and ${MAX_LIMIT}`,
        });
        return;
      }

      const rows = await query<ListingRow>(
        `SELECT ${LISTING_COLUMNS} ${LISTING_FROM}
          WHERE l.seller_user_id = $1
            AND NOT (l.seller_user_id = ANY($2::uuid[]))
          ORDER BY l.created_at DESC, l.listing_id DESC
          LIMIT $3`,
        [caller.user_id, Array.from(SHARED_SEED_SELLER_IDS), limit],
      );

      const photosMap = await loadListingPhotos(rows.map(r => r.listing_id));
      res.status(200).json({
        listings: rows.map(r => toOwnerListing(r, photosMap.get(r.listing_id) || [])),
        count: rows.length,
      });
    } catch (err) {
      failDb(res, err, 'listings/mine');
    }
  }),
);

/**
 * POST /marketplace/listings
 *
 * Order of operations matters here. Validation runs before the role check only
 * where it must, because a 403 that tells an unverified caller nothing about the
 * listing is better than a 400 that validates content they may not post.
 *
 * The moderation verdict decides the stored status, not the response status:
 * a blocked listing is created with 201 and its blocked state, so the client can
 * show the block modal it already has.
 */
listingsRouter.post(
  '/listings',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;

    // Check strike status before attempting to post
    const canPost = await assertCanPost(caller.user_id);
    if ('locked' in canPost) {
      res.status(423).json({
        error: 'posting_locked',
        locked_until: canPost.locked_until.toISOString(),
        message: 'Posting is paused for now',
      });
      return;
    }
    if ('banned' in canPost) {
      res.status(403).json({
        error: 'account_banned',
      });
      return;
    }

    if (!consumeCreateQuota(caller.user_id)) {
      res.status(429).json({
        error: 'rate_limited',
        message: 'You have reached the listing limit for this hour. Please try again later.',
      });
      return;
    }

    if (!isVerifiedMarketplaceUser(caller)) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Your Marketplace access is not verified yet',
      });
      return;
    }

    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const categoryName = typeof body.category === 'string' ? body.category.trim() : '';

      // The category is resolved against permitted_categories, which is the same
      // row the listings foreign key points at, so an unknown or deactivated
      // category cannot be written.
      const categories = await query<{ category_id: string }>(
        'SELECT category_id FROM permitted_categories WHERE category_name = $1 AND is_active = true',
        [categoryName],
      );
      if (categories.length === 0) {
        res.status(400).json({
          error: 'validation_error',
          message: 'category is not a recognized marketplace category',
          fields: { category: 'Choose a category from the list' },
        });
        return;
      }

      const parsed = parseListingInput(body, { category_id: categories[0].category_id });
      if (!parsed.ok) {
        res.status(400).json({
          error: 'validation_error',
          message: parsed.message,
          fields: parsed.fields,
        });
        return;
      }
      const input = parsed.value;

      // Category rules and role rules are two different mistakes, so they get two
      // different answers: a post type the category cannot hold is a form problem
      // (400), a post type this account's role does not cover is a permission
      // problem (403).
      if (!categoryAllowsPostType(input.category, input.post_type)) {
        const permittedHere = postTypesForCategory(input.category);
        res.status(400).json({
          error: 'validation_error',
          message: `${input.category} only accepts ${permittedHere.join(' and ')} posts`,
          fields: { post_type: `Choose ${permittedHere.join(' or ')} for this category` },
        });
        return;
      }

      // Role comes from the users row, never from the body.
      if (!roleAllowsPostType(caller, input.post_type)) {
        res.status(403).json({
          error: 'forbidden',
          message: 'Your Marketplace role does not allow this kind of post',
        });
        return;
      }

      // Quality gate: check if the text appears to be real words before moderation.
      // Gibberish listings (keyboard mash, repeated characters) fail here and are
      // never stored or moderated.
      const qualityFields = {
        title: input.title,
        description: input.description,
        trade_offered_item: input.trade_offered_item,
        trade_wanted_item: input.trade_wanted_item,
      };
      const quality = checkListingQuality(qualityFields);
      if (!quality.ok) {
        const fields: Record<string, string> = {};
        for (const issue of quality.issues) {
          fields[issue.field] = QUALITY_MESSAGE;
        }
        console.warn(
          `[marketplace] listing rejected user=${caller.user_id} gate=quality codes=${quality.issues
            .map((issue) => issue.code)
            .join(',')} fields=${quality.issues.map((issue) => issue.field).join(',')}`,
        );
        res.status(422).json({
          error: 'listing_quality',
          message: QUALITY_MESSAGE,
          fields,
        });
        return;
      }

      const verdict = await checkListingContent({
        title: input.title,
        description: input.description,
        category: input.category,
        trade_offered_item: input.trade_offered_item,
        trade_wanted_item: input.trade_wanted_item,
        deposit_note: input.deposit_note,
      });

      // Refused before the INSERT, so a listing that fails a content gate never
      // becomes a row: no status to reconcile, no reason to store, nothing for a
      // later cleanup to find. The codes and fields are logged because a
      // moderation log carrying the text would be a second copy of everything
      // the rules keep out; the response carries neither.
      if (!verdict.allowed) {
        const summary = violationSummary(verdict.violations);
        console.warn(
          `[marketplace] listing rejected user=${caller.user_id} gate=moderation fields=${summary.fields} codes=${summary.codes} screener=${verdict.screener_version}`,
        );

        // Record strike and apply penalty
        const strikeInfo = await recordViolation(
          caller.user_id,
          'text',
          summary.codes.split(',')[0] || 'content_blocked',
        );

        res.status(422).json({
          error: 'content_rejected',
          message: CREATE_REJECTED_MESSAGE,
          next_penalty: strikeInfo.next_penalty,
          action: strikeInfo.action,
          locked_until: strikeInfo.locked_until?.toISOString(),
        });
        return;
      }

      // The same seller re-posting the same title in the same category is a
      // copy, not a second item. Matched on the title normalised the way both
      // sides normalise it, so trailing spaces and case do not create a
      // second listing. Sold and cancelled rows are deliberately not matched:
      // an item that sold, or that the seller took down, can be listed again.
      const normalisedTitle = normaliseForDuplicate(input.title);
      const normalisedDesc = normaliseForDuplicate(input.description);
      const duplicates = await query<{ listing_id: string }>(
        `SELECT listing_id
           FROM listings
          WHERE seller_user_id = $1
            AND category_id = $2
            AND listing_status = ANY($3::varchar[])
            AND lower(btrim(regexp_replace(item_title, '[[:space:]]+', ' ', 'g'))) = $4
            AND lower(btrim(regexp_replace(item_description, '[[:space:]]+', ' ', 'g'))) = $5
          LIMIT 1`,
        [caller.user_id, input.category_id, DUPLICATE_STATUSES as string[], normalisedTitle, normalisedDesc],
      );
      if (duplicates.length > 0) {
        console.warn(
          `[marketplace] listing rejected user=${caller.user_id} gate=duplicate status=409`,
        );
        res.status(409).json({
          error: 'duplicate_listing',
          message: 'You already have this listing on the marketplace. Edit or remove it instead.',
        });
        return;
      }

      // Validate photo_ids: must be pending and owned by caller
      const photoIds = input.photo_ids || [];
      if (photoIds.length > 0) {
        const photoCheck = await query<{ id: string }>(
          `SELECT id FROM listing_photos
           WHERE id = ANY($1::uuid[])
             AND owner_user_id = $2
             AND listing_id IS NULL`,
          [photoIds, caller.user_id]
        );
        if (photoCheck.length !== photoIds.length) {
          res.status(400).json({
            error: 'invalid_photo_ids',
            message: 'One or more photo IDs are invalid or not owned by you.',
          });
          return;
        }
      }

      // Two statements rather than INSERT ... RETURNING through a CTE: a
      // data-modifying CTE and the main query share one snapshot, so the main
      // query cannot see the row it just inserted. Write, then read it back.
      const inserted = await query<{ listing_id: string }>(
        `INSERT INTO listings (
           seller_user_id, item_title, item_description, category_id,
           transaction_type, price, price_outlier, condition, photo_urls,
           screening_result, listing_status, appeal_status,
           post_type, budget, rate, rental_fee, rental_period_days, deposit_note,
           trade_offered_item, trade_wanted_item, trade_estimated_value,
           request_deadline, handoff_method, open_to_trade, screener_version,
           published_at, created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,
           'passed','active','none',
           $10,$11,$12,$13,$14,$15,
           $16,$17,$18,
           $19,$20,$21,$22,
           $23::timestamptz,
           NOW(), NOW()
         )
         RETURNING listing_id`,
        [
          caller.user_id,
          input.title,
          input.description,
          input.category_id,
          legacyTransactionType(input.post_type),
          input.price,
          input.price > PRICE_OUTLIER_PHP ? 'high' : null,
          input.condition,
          JSON.stringify([]), // Legacy photo_urls field, empty
          input.post_type,
          input.budget,
          input.rate,
          input.rental_fee,
          input.rental_period_days,
          input.deposit_note,
          input.trade_offered_item,
          input.trade_wanted_item,
          input.trade_estimated_value,
          input.request_deadline,
          input.handoff_method,
          input.open_to_trade,
          verdict.screener_version,
          new Date(),
        ],
      );

      // Attach photos in the given order
      if (photoIds.length > 0) {
        for (let i = 0; i < photoIds.length; i++) {
          await query(
            `UPDATE listing_photos
             SET listing_id = $1, position = $2, attached_at = NOW()
             WHERE id = $3`,
            [inserted[0].listing_id, i, photoIds[i]]
          );
        }
      }

      const created = await readListing(inserted[0]?.listing_id ?? null);
      if (!created) {
        failDb(res, new Error('listing insert returned no row'), 'create');
        return;
      }

      // Load photos for the created listing
      const photosMap = await loadListingPhotos([created.listing_id]);
      const listingPhotos = photosMap.get(created.listing_id) || [];

      // Everything the caller needs to know about a refusal arrived as a 422,
      // so the accepted answer is just the listing. A client that skipped the
      // pre-check gets the generic refusal above rather than a list of codes.
      res.status(201).json({ listing: toOwnerListing(created, listingPhotos) });
    } catch (err) {
      failDb(res, err, 'create');
    }
  }),
);

/**
 * Load photos for one or more listings.
 * Returns map of listing_id -> [{photo_id, path}]
 */
async function loadListingPhotos(listingIds: string[]): Promise<Map<string, Array<{ photo_id: string; path: string }>>> {
  if (listingIds.length === 0) return new Map();
  
  const rows = await query<{ listing_id: string; id: string; file_path: string; position: number }>(
    `SELECT listing_id, id, file_path, position
     FROM listing_photos
     WHERE listing_id = ANY($1::uuid[])
     ORDER BY position`,
    [listingIds]
  );

  const map = new Map<string, Array<{ photo_id: string; path: string }>>();
  for (const row of rows) {
    if (!map.has(row.listing_id)) {
      map.set(row.listing_id, []);
    }
    map.get(row.listing_id)!.push({ photo_id: row.id, path: row.file_path });
  }
  return map;
}

/** Reads one listing with its category and seller name. Null when absent. */
async function readListing(listingId: string | null): Promise<ListingRow | null> {
  if (listingId === null) return null;
  const rows = await query<ListingRow>(
    `SELECT ${LISTING_COLUMNS} ${LISTING_FROM} WHERE l.listing_id = $1`,
    [listingId],
  );
  return rows[0] ?? null;
}

/**
 * Answers with the listing the caller just changed.
 *
 * The row was written a moment ago, so a missing read is a database problem
 * rather than a 404, and it is mapped as one instead of being answered with a
 * null body.
 */
async function sendListing(res: Response, listing: ListingRow | null, route: string): Promise<void> {
  if (!listing) {
    failDb(res, new Error('listing read back returned no row'), route);
    return;
  }
  const photosMap = await loadListingPhotos([listing.listing_id]);
  const photos = photosMap.get(listing.listing_id) || [];
  res.status(200).json({ listing: toOwnerListing(listing, photos) });
}

/**
 * Loads a listing and checks the caller may act on it.
 *
 * 404 when it does not exist, 403 when it exists but belongs to someone else.
 * A non-owner must not be able to learn that a listing exists by comparing 403
 * with 404 on ids they cannot see, so both answers stay generic.
 */
async function loadAuthorisedListing(
  listingId: string,
  caller: MarketplaceCaller,
  res: Response,
  options: { allowHead?: boolean } = {},
): Promise<ListingRow | null> {
  const row = await readListing(listingId);
  if (!row) {
    res.status(404).json({ error: 'not_found', message: 'That listing does not exist' });
    return null;
  }

  const isOwner = row.seller_user_id === caller.user_id;
  const headAllowed = options.allowHead === true && isHeadOrganizer(caller);
  if (!isOwner && !headAllowed) {
    res.status(403).json({
      error: 'forbidden',
      message: 'You can only change your own listings',
    });
    return null;
  }
  return row;
}

/**
 * POST /marketplace/listings/:id/sold
 *
 * Owner only, and only from 'active'.
 *
 * KNOWN LIMIT: offers are still local to each device (AsyncStorage), so the
 * "is there an accepted offer on this listing" check that a real sold flow needs
 * cannot be enforced here yet. A seller can therefore mark a listing sold while
 * an offer is open. Part 3 moves offers onto the server and adds the check here;
 * until then this endpoint is deliberately simple rather than pretending.
 */
listingsRouter.post(
  '/listings/:id/sold',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;
    const id = readId(req, res);
    if (!id) return;

    try {
      const existing = await loadAuthorisedListing(id, caller, res);
      if (!existing) return;

      if (existing.listing_status !== 'active') {
        res.status(409).json({
          error: 'listing_state',
          message: 'Only an active listing can be marked sold',
        });
        return;
      }

      const updated = await query<{ listing_id: string }>(
        `UPDATE listings
            SET listing_status = 'sold', updated_at = NOW()
          WHERE listing_id = $1 AND seller_user_id = $2 AND listing_status = 'active'
          RETURNING listing_id`,
        [id, caller.user_id],
      );
      if (updated.length === 0) {
        // Lost a race with a concurrent sold or remove, so the state the caller
        // asked for is no longer reachable. The 409 says so without echoing it.
        res.status(409).json({
          error: 'listing_state',
          message: 'Only an active listing can be marked sold',
        });
        return;
      }

      await sendListing(res, await readListing(id), 'sold');
    } catch (err) {
      failDb(res, err, 'sold');
    }
  }),
);

/** Statuses a listing can be pulled from. Anything else is already finished. */
const REMOVABLE_STATUSES: readonly string[] = ['active', 'blocked'];

/**
 * POST /marketplace/listings/:id/remove
 *
 * Owner, or a Head Organizer acting on any listing. Optional reason, validated
 * against the removed_reason values migration 014 allows.
 *
 * WORKS FROM 'blocked' AS WELL AS 'active'
 * A blocked listing is a listing the seller can see in their own /mine and can
 * appeal. If they appeal and then change their mind, or they would rather just
 * take it down than wait for a decision, refusing to let them remove it strands
 * them: the only way out of a block becomes winning the appeal. So 'active' and
 * 'blocked' are both removable, and 'cancelled' and 'sold' are not, because those
 * are finished and re-removing them would rewrite history.
 *
 * A PENDING APPEAL IS CLEARED
 * If the listing had an appeal waiting for a Head, removing the listing cancels
 * that appeal. Leaving it pending would put a decision request against a listing
 * nobody can act on any more, and the Head reviewing it would be reviewing
 * something the seller already took back. Only a pending appeal is touched; an
 * appeal that was already decided keeps its outcome, because that decision is a
 * record and not a to-do item.
 *
 * The reason is optional on purpose. A seller pulling a listing because they sold
 * it elsewhere, because it is gone, or because they posted it by mistake are three
 * different facts, but a seller who just wants it off the marketplace should not
 * have to pick one to be believed. An absent or empty reason is stored as NULL and
 * an unrecognised one is a 400, because a reason nobody can act on is worse than
 * no reason.
 *
 * Both `reason` and `removed_reason` are accepted. `reason` is the documented body
 * field; `removed_reason` matches the column name and is what scripts/verify_marketplace.ps1
 * sends. Rejecting the column name for being spelled like the column would fail an
 * acceptance test over a naming preference, so it is honoured instead.
 *
 * The moderation fields are deliberately left alone: a listing that was taken
 * down keeps its screening_result and its screening_reason, because "removed" and
 * "blocked" are different facts and the seller is entitled to see which one
 * happened to them.
 */
listingsRouter.post(
  '/listings/:id/remove',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;
    const id = readId(req, res);
    if (!id) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    let reason: string | null = null;
    const rawReason = body.reason ?? body.removed_reason;
    if (rawReason !== undefined && rawReason !== null && rawReason !== '') {
      if (typeof rawReason !== 'string' || !(REMOVED_REASONS as readonly string[]).includes(rawReason)) {
        res.status(400).json({
          error: 'validation_error',
          message: 'reason is not a recognised removal reason',
          fields: { reason: `Use one of: ${REMOVED_REASONS.join(', ')}` },
        });
        return;
      }
      reason = rawReason;
    }

    try {
      const existing = await loadAuthorisedListing(id, caller, res, { allowHead: true });
      if (!existing) return;

      if (!REMOVABLE_STATUSES.includes(existing.listing_status)) {
        res.status(409).json({
          error: 'listing_state',
          message: 'Only an active or blocked listing can be removed',
        });
        return;
      }

      const updated = await query<{ listing_id: string }>(
        `UPDATE listings
            SET listing_status = 'cancelled',
                removed_at = NOW(),
                removed_reason = $2,
                appeal_status = CASE
                  WHEN appeal_status = 'pending' THEN 'none'
                  ELSE appeal_status
                END,
                updated_at = NOW()
          WHERE listing_id = $1 AND listing_status = ANY($3::varchar[])
          RETURNING listing_id`,
        [id, reason, REMOVABLE_STATUSES as string[]],
      );
      if (updated.length === 0) {
        res.status(409).json({
          error: 'listing_state',
          message: 'Only an active or blocked listing can be removed',
        });
        return;
      }

      await sendListing(res, await readListing(id), 'remove');
    } catch (err) {
      failDb(res, err, 'remove');
    }
  }),
);

/**
 * POST /marketplace/listings/:id/appeal
 *
 * Owner only, blocked listings only. Stores the seller's appeal text and sets
 * appeal_status to 'pending'.
 *
 * appeal_status is never read from the body: a client that could set it could
 * mark its own listing 'overturned' and skip the review entirely. The Holder
 * decision surface is a later part; until it exists a pending appeal simply
 * waits.
 */
listingsRouter.post(
  '/listings/:id/appeal',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;
    const id = readId(req, res);
    if (!id) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message === '') {
      res.status(400).json({
        error: 'validation_error',
        message: 'Explain why the listing should be reconsidered',
        fields: { message: 'Enter a message' },
      });
      return;
    }
    if (message.length > APPEAL_MESSAGE_MAX) {
      res.status(400).json({
        error: 'validation_error',
        message: `message must be at most ${APPEAL_MESSAGE_MAX} characters`,
        fields: { message: `At most ${APPEAL_MESSAGE_MAX} characters` },
      });
      return;
    }

    try {
      const existing = await loadAuthorisedListing(id, caller, res);
      if (!existing) return;

      if (existing.screening_result !== 'blocked') {
        res.status(409).json({
          error: 'not_blocked',
          message: 'Only a blocked listing can be appealed',
        });
        return;
      }

      const updated = await query<{ listing_id: string }>(
        `UPDATE listings
            SET appeal_status = 'pending',
                appeal_message = $2,
                updated_at = NOW()
          WHERE listing_id = $1
            AND seller_user_id = $3
            AND screening_result = 'blocked'
          RETURNING listing_id`,
        [id, message, caller.user_id],
      );
      if (updated.length === 0) {
        res.status(409).json({
          error: 'not_blocked',
          message: 'Only a blocked listing can be appealed',
        });
        return;
      }

      await sendListing(res, await readListing(id), 'appeal');
    } catch (err) {
      failDb(res, err, 'appeal');
    }
  }),
);

/**
 * DELETE /marketplace/listings/:id
 *
 * Permanently delete a listing (owner only).
 *
 * Only works for listings in 'cancelled' or 'blocked' status. An 'active' or
 * 'sold' listing must be removed first (POST /remove), then deleted.
 * Non-owner gets 403, active/sold listing gets 409, unknown id gets 404.
 */
listingsRouter.delete(
  '/listings/:id',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;
    const id = readId(req, res);
    if (!id) return;

    try {
      const existing = await loadAuthorisedListing(id, caller, res);
      if (!existing) return;

      // Only cancelled or blocked listings can be permanently deleted
      if (existing.listing_status !== 'cancelled' && existing.listing_status !== 'blocked') {
        res.status(409).json({
          error: 'invalid_status',
          message: 'Only removed or blocked listings can be permanently deleted. Remove an active listing first.',
        });
        return;
      }

      // Delete the listing
      const deleted = await query<{ listing_id: string }>(
        `DELETE FROM listings
          WHERE listing_id = $1
            AND seller_user_id = $2
          RETURNING listing_id`,
        [id, caller.user_id],
      );

      if (deleted.length === 0) {
        res.status(404).json({ error: 'not_found', message: 'Listing not found' });
        return;
      }

      res.status(200).json({ message: 'Listing permanently deleted' });
    } catch (err) {
      failDb(res, err, 'delete');
    }
  }),
);

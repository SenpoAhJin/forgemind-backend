/**
 * Marketplace Registration Routes
 * POST /marketplace/registration      - create or replace own registration (Cosplayer)
 * GET  /marketplace/registration/me   - read own registration (masked payout)
 *
 * Listing routes (browse, create, sold, remove, appeal) live in
 * ./listingsRouter and are mounted below, so they sit at /marketplace/listings...
 * just as if they were declared here.
 *
 * Authorization rules:
 * - The caller is identified by the session, never by a body field. `user_id`
 *   and `verification_status` sent by a client are ignored.
 * - Cosplayers only. A Staff or Head account gets 403.
 * - One registration per user, enforced by the unique registration columns on
 *   `users`, so a repeat submission updates that row instead of inserting a
 *   second one.
 */

import { Request, Response, Router, NextFunction } from 'express';
import { query, withTransaction } from '../db';
import { requireSession } from '../auth/session';
import { moderateListing, moderateDisplayName, LIMITS } from '../moderation';
import { PERMITTED_CATEGORY_SLUGS } from '../moderation/rules';
import { listingsRouter } from './listingsRouter';
import {
  parseRegistrationInput,
  toRegistrationPublic,
  SUBMITTABLE_STATUSES,
  RegistrationRow,
} from './registration';

export const marketplaceRouter = Router();

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * Listing endpoints. Mounted as a sub-router so /marketplace/listings, .../mine
 * and .../:id/sold all resolve here.
 */
marketplaceRouter.use(listingsRouter);

/** Columns read back for the owner. payout_method_number stays server-side. */
const REGISTRATION_COLUMNS = `
  marketplace_role,
  seller_display_name,
  marketplace_contact_email,
  marketplace_contact_phone,
  payout_method_label,
  payout_method_number,
  agreed_to_marketplace_terms,
  marketplace_terms_accepted_at,
  marketplace_submitted_at,
  marketplace_rejection_reason
`;

marketplaceRouter.post(
  '/registration',
  asyncHandler(async (req, res) => {
    const user = await requireSession(req, res);
    if (!user) return;

    // Staff and Head accounts do not register for the marketplace. Server-side
    // permission, so a crafted request cannot bypass this.
    if (user.is_organizer || user.organizer_role !== null || !user.is_cosplayer) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only cosplayer accounts can register for the Marketplace',
      });
      return;
    }

    if (!SUBMITTABLE_STATUSES.has(user.verification_status)) {
      res.status(409).json({
        error: 'registration_locked',
        message:
          user.verification_status === 'verified'
            ? 'Your Marketplace access is already verified'
            : 'Your Marketplace access has been revoked. Contact a Head Organizer.',
      });
      return;
    }

    const parsed = parseRegistrationInput(req.body);
    if (!parsed.ok || !parsed.value) {
      res.status(400).json({
        error: 'validation_error',
        message: parsed.message,
        fields: parsed.fields,
      });
      return;
    }

    const input = parsed.value;

    // Language rules on the seller display name, because it is shown publicly
    // on every listing. Relevance does not apply to a name. Uses the same
    // moderateDisplayName() the listing check uses, so both stay in step.
    const nameModeration = moderateDisplayName(input.seller_display_name);
    if (!nameModeration.allowed) {
      res.status(400).json({
        error: 'validation_error',
        message: 'seller_display_name contains language that is not allowed',
        fields: { seller_display_name: nameModeration.violations[0]?.message ?? 'Please reword this.' },
      });
      return;
    }

    const saved = await withTransaction(async (client) => {
      // Re-read the status inside the transaction so a concurrent approval
      // between the check above and this write cannot be overwritten.
      const locked = await client.query<{ verification_status: string }>(
        'SELECT verification_status FROM users WHERE user_id = $1 FOR UPDATE',
        [user.user_id],
      );
      const status = locked.rows[0]?.verification_status;
      if (!status || !SUBMITTABLE_STATUSES.has(status)) {
        return null;
      }

      const result = await client.query<RegistrationRow>(
        `UPDATE users
            SET marketplace_role = $1,
                seller_display_name = $2,
                marketplace_contact_email = $3,
                marketplace_contact_phone = $4,
                payout_method_label = $5,
                payout_method_number = $6,
                agreed_to_marketplace_terms = $7,
                marketplace_terms_accepted_at = NOW(),
                marketplace_submitted_at = NOW(),
                marketplace_rejection_reason = NULL,
                rejection_reason = NULL,
                verified_by_user_id = NULL,
                verified_at = NULL,
                verification_status = 'pending',
                updated_at = NOW()
          WHERE user_id = $8
        RETURNING ${REGISTRATION_COLUMNS}`,
        [
          input.marketplace_role,
          input.seller_display_name,
          input.marketplace_contact_email,
          input.marketplace_contact_phone,
          input.payout_method_label,
          input.payout_method_number,
          input.agreed_to_marketplace_terms,
          user.user_id,
        ],
      );

      return result.rows[0] ?? null;
    });

    if (!saved) {
      res.status(409).json({
        error: 'registration_locked',
        message: 'Your Marketplace verification status changed. Reload and try again.',
      });
      return;
    }

    res.status(200).json({
      registration: toRegistrationPublic(saved),
      verification_status: 'pending',
    });
  }),
);

marketplaceRouter.get(
  '/registration/me',
  asyncHandler(async (req, res) => {
    const user = await requireSession(req, res);
    if (!user) return;

    const rows = await query<RegistrationRow>(
      `SELECT ${REGISTRATION_COLUMNS} FROM users WHERE user_id = $1`,
      [user.user_id],
    );

    const registration = rows[0] ? toRegistrationPublic(rows[0]) : null;

    res.status(200).json({
      registration,
      verification_status: user.verification_status,
    });
  }),
);

/**
 * Per-user rate limit for the check endpoint, in memory.
 *
 * Deliberately no new dependency. The counters live in this process, so a
 * multi-instance deploy would enforce the limit per instance. That is
 * acceptable here: the limit exists to stop a client from hammering the
 * normalizer, not to enforce a quota.
 */
const CHECK_RATE_LIMIT = 30;
const CHECK_RATE_WINDOW_MS = 60_000;

interface RateBucket {
  count: number;
  windowStart: number;
}

const checkBuckets = new Map<string, RateBucket>();

function consumeCheckQuota(userId: string): boolean {
  const now = Date.now();
  const bucket = checkBuckets.get(userId);
  if (!bucket || now - bucket.windowStart >= CHECK_RATE_WINDOW_MS) {
    checkBuckets.set(userId, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= CHECK_RATE_LIMIT) return false;
  bucket.count += 1;
  return true;
}

// Keep the map from growing without bound across a long-running process.
const bucketSweep = setInterval(() => {
  const cutoff = Date.now() - CHECK_RATE_WINDOW_MS;
  for (const [key, bucket] of checkBuckets) {
    if (bucket.windowStart < cutoff) checkBuckets.delete(key);
  }
}, CHECK_RATE_WINDOW_MS);
bucketSweep.unref();

interface CheckBody {
  title?: unknown;
  description?: unknown;
  category?: unknown;
}

/**
 * POST /marketplace/listings/check
 *
 * Pre-publish content check for a listing. The client calls this before saving
 * and blocks the save when `allowed` is false.
 *
 * IMPORTANT: a future POST /marketplace/listings or PUT that actually creates
 * or edits a listing MUST call the same moderateListing() inside the write
 * path. This endpoint is a convenience for the UI, not the enforcement point,
 * because a modified client can skip it. Once listings live in the database,
 * move the check into the write and keep this endpoint for early feedback.
 */
marketplaceRouter.post(
  '/listings/check',
  asyncHandler(async (req, res) => {
    const user = await requireSession(req, res);
    if (!user) return;

    // Sellers only: an organizer account must not post listings.
    if (!user.is_cosplayer || user.is_organizer || user.organizer_role !== null) {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only verified cosplayer sellers can check listings',
      });
      return;
    }

    if (!consumeCheckQuota(user.user_id)) {
      res.status(429).json({
        error: 'rate_limited',
        message: 'Too many checks. Please wait a moment and try again.',
      });
      return;
    }

    const body = (req.body ?? {}) as CheckBody;
    const title = typeof body.title === 'string' ? body.title : '';
    const description = typeof body.description === 'string' ? body.description : '';
    const category = typeof body.category === 'string' ? body.category : '';

    if (
      typeof body.title !== 'string' ||
      typeof body.description !== 'string' ||
      typeof body.category !== 'string'
    ) {
      res.status(400).json({
        error: 'validation_error',
        message: 'title, description and category must all be strings',
      });
      return;
    }

    // Existing length limits still apply; moderation never widens them.
    if (title.length > LIMITS.titleMax || description.length > LIMITS.descriptionMax) {
      res.status(400).json({
        error: 'validation_error',
        message: `title must be at most ${LIMITS.titleMax} characters and description at most ${LIMITS.descriptionMax}`,
      });
      return;
    }

    if (!PERMITTED_CATEGORY_SLUGS.includes(category)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'category is not a recognized marketplace category',
      });
      return;
    }

    const result = moderateListing({ title, description, category });

    // Log the codes and which field tripped, never the listing text. A
    // moderation log containing the blocked text would itself become a copy
    // of everything the rules are trying to keep out of the marketplace.
    if (!result.allowed) {
      const fields = [...new Set(result.violations.map((violation) => violation.field))];
      console.warn(
        `[moderation] listing rejected user=${user.user_id} fields=${fields.join(',')} codes=${[
          ...new Set(result.violations.map((violation) => violation.code)),
        ].join(',')}`,
      );
    }

    res.status(200).json(result);
  }),
);

/**
 * Marketplace Offers Router
 *
 * Manages structured offers (purchase, trade, commission) on marketplace listings.
 * All business rules enforced server-side. Never returns email addresses.
 */

import { Router, Request, Response } from 'express';
import { requireSession, SessionUser } from '../auth/session';
import { query, withTransaction } from '../db';
import {
  requireMarketplaceUser,
  isVerifiedMarketplaceUser,
  MarketplaceCaller,
} from './rules';
import { isOfferTypeAllowedForCategory } from './offerRules';

const offersRouter = Router();

type OfferType = 'purchase' | 'trade' | 'commission';
type OfferStatus = 'pending' | 'accepted' | 'awaiting_confirmation' | 'completed' | 'declined' | 'withdrawn';

interface OfferRow {
  offer_id: string;
  listing_id: string;
  proposer_user_id: string;
  offer_type: OfferType;
  status: OfferStatus;
  offered_price: string | null;
  offered_item_id: string | null;
  trade_offered_item: string | null;
  trade_offered_condition: string | null;
  trade_offered_est_value: string | null;
  commission_scope: string | null;
  commission_description: string | null;
  commission_timeline_days: number | null;
  offer_notes: string | null;
  listing_title: string | null;
  listing_price: string | null;
  proposer_display_name: string | null;
  seller_display_name: string | null;
  proposer_confirmed_at: Date | null;
  recipient_confirmed_at: Date | null;
  created_at: Date;
  responded_at: Date | null;
  updated_at: Date;
}

interface CreateOfferInput {
  listing_id: string;
  offer_type: OfferType;
  offered_price?: number;
  trade_offered_item?: string;
  trade_offered_condition?: string;
  trade_offered_est_value?: number;
  commission_description?: string;
  timeline_days?: number;
  offer_notes?: string;
}

/**
 * POST /marketplace/offers
 * Create a new offer on a listing.
 *
 * Rules enforced:
 * - Caller must be verified marketplace participant
 * - Listing must exist and be active
 * - Proposer cannot be the listing seller
 * - Offer type must be allowed for the listing's category
 * - No duplicate pending offer by same proposer on same listing
 * - Type-specific fields required (price for purchase, item for trade, etc.)
 */
offersRouter.post('/', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  if (!isVerifiedMarketplaceUser(caller)) {
    res.status(403).json({
      error: 'marketplace_verification_required',
      message: 'You must be a verified marketplace participant to make offers.',
    });
    return;
  }

  const input = req.body as CreateOfferInput;

  // Validate input
  if (!input.listing_id || typeof input.listing_id !== 'string') {
    res.status(400).json({ error: 'invalid_input', message: 'listing_id is required' });
    return;
  }

  if (!input.offer_type || !['purchase', 'trade', 'commission'].includes(input.offer_type)) {
    res.status(400).json({ error: 'invalid_input', message: 'offer_type must be purchase, trade, or commission' });
    return;
  }

  // Load listing
  const listingRows = await query<{
    listing_id: string;
    seller_user_id: string;
    listing_status: string;
    category_id: string;
    item_title: string;
    price: string;
    seller_display_name: string | null;
  }>(
    `SELECT l.listing_id, l.seller_user_id, l.listing_status, l.category_id, l.item_title, l.price,
            u.seller_display_name
       FROM listings l
       JOIN users u ON u.user_id = l.seller_user_id
      WHERE l.listing_id = $1`,
    [input.listing_id],
  );

  if (listingRows.length === 0) {
    res.status(404).json({ error: 'listing_not_found', message: 'That listing no longer exists.' });
    return;
  }

  const listing = listingRows[0];

  // Rule: listing must be active
  if (listing.listing_status !== 'active') {
    res.status(400).json({ error: 'listing_not_active', message: 'That listing is no longer accepting offers.' });
    return;
  }

  // Rule: proposer cannot be the seller
  if (listing.seller_user_id === caller.user_id) {
    res.status(400).json({ error: 'own_listing', message: 'You cannot make an offer on your own listing.' });
    return;
  }

  // Rule: offer type must be allowed for category
  // Load category name
  const categoryRows = await query<{ category_name: string }>(
    'SELECT category_name FROM permitted_categories WHERE category_id = $1',
    [listing.category_id],
  );
  const categoryName = categoryRows[0]?.category_name || '';

  if (!isOfferTypeAllowedForCategory(categoryName, input.offer_type)) {
    res.status(400).json({
      error: 'offer_type_not_allowed',
      message: 'That offer type is not available for this listing category.',
    });
    return;
  }

  // Rule: no duplicate pending offer
  const existingRows = await query<{ offer_id: string }>(
    `SELECT offer_id FROM structured_offers
      WHERE listing_id = $1 AND proposer_user_id = $2 AND status = 'pending'`,
    [input.listing_id, caller.user_id],
  );

  if (existingRows.length > 0) {
    res.status(409).json({
      error: 'duplicate_pending_offer',
      message: 'You already have a pending offer on this listing.',
    });
    return;
  }

  // Validate type-specific fields
  if (input.offer_type === 'purchase') {
    if (typeof input.offered_price !== 'number' || input.offered_price <= 0) {
      res.status(400).json({ error: 'invalid_input', message: 'offered_price is required for purchase offers' });
      return;
    }
  }

  if (input.offer_type === 'trade') {
    if (!input.trade_offered_item || input.trade_offered_item.trim().length === 0) {
      res.status(400).json({ error: 'invalid_input', message: 'trade_offered_item is required for trade offers' });
      return;
    }
  }

  if (input.offer_type === 'commission') {
    if (!input.commission_description || input.commission_description.trim().length === 0) {
      res.status(400).json({
        error: 'invalid_input',
        message: 'commission_description is required for commission offers',
      });
      return;
    }
    if (typeof input.timeline_days !== 'number' || input.timeline_days < 1 || input.timeline_days > 365) {
      res.status(400).json({
        error: 'invalid_input',
        message: 'timeline_days must be between 1 and 365 for commission offers',
      });
      return;
    }
  }

  // Create offer
  const offerRows = await query<OfferRow>(
    `INSERT INTO structured_offers (
       listing_id, proposer_user_id, offer_type, status,
       offered_price, trade_offered_item, trade_offered_condition, trade_offered_est_value,
       commission_description, commission_timeline_days, offer_notes,
       listing_title, listing_price, proposer_display_name, seller_display_name
     ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.listing_id,
      caller.user_id,
      input.offer_type,
      input.offered_price || null,
      input.trade_offered_item || null,
      input.trade_offered_condition || null,
      input.trade_offered_est_value || null,
      input.commission_description || null,
      input.timeline_days || null,
      input.offer_notes || null,
      listing.item_title,
      listing.price,
      caller.display_name,
      listing.seller_display_name,
    ],
  );

  res.status(201).json(formatOffer(offerRows[0]));
});

/**
 * GET /marketplace/offers/sent
 * List offers sent by the authenticated user.
 * Query params: ?status=pending|accepted|declined|withdrawn (optional)
 */
offersRouter.get('/sent', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  const statusFilter = req.query.status as string | undefined;
  let statusClause = '';
  const params: any[] = [caller.user_id];

  if (statusFilter && ['pending', 'accepted', 'declined', 'withdrawn'].includes(statusFilter)) {
    statusClause = ' AND status = $2';
    params.push(statusFilter);
  }

  const offers = await query<OfferRow>(
    `SELECT * FROM structured_offers
      WHERE proposer_user_id = $1${statusClause}
      ORDER BY created_at DESC`,
    params,
  );

  res.json({ offers: offers.map(formatOffer) });
});

/**
 * GET /marketplace/offers/received
 * List offers received on the authenticated user's listings.
 * Query params: ?listing_id=<uuid> (optional), ?status=... (optional)
 */
offersRouter.get('/received', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  const listingIdFilter = req.query.listing_id as string | undefined;
  const statusFilter = req.query.status as string | undefined;

  let whereClauses = ['l.seller_user_id = $1'];
  const params: any[] = [caller.user_id];

  if (listingIdFilter) {
    whereClauses.push(`o.listing_id = $${params.length + 1}`);
    params.push(listingIdFilter);
  }

  if (statusFilter && ['pending', 'accepted', 'declined', 'withdrawn'].includes(statusFilter)) {
    whereClauses.push(`o.status = $${params.length + 1}`);
    params.push(statusFilter);
  }

  const offers = await query<OfferRow>(
    `SELECT o.* FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY o.created_at DESC`,
    params,
  );

  res.json({ offers: offers.map(formatOffer) });
});

/**
 * GET /marketplace/offers/:offer_id
 * Get a single offer. User must be proposer or listing seller.
 */
offersRouter.get('/:offer_id', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  const offerRows = await query<OfferRow & { seller_user_id: string }>(
    `SELECT o.*, l.seller_user_id
       FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE o.offer_id = $1`,
    [req.params.offer_id],
  );

  if (offerRows.length === 0) {
    res.status(404).json({ error: 'offer_not_found', message: 'Offer not found.' });
    return;
  }

  const offer = offerRows[0];

  // User must be proposer or seller
  if (offer.proposer_user_id !== caller.user_id && offer.seller_user_id !== caller.user_id) {
    res.status(403).json({ error: 'forbidden', message: 'You do not have access to this offer.' });
    return;
  }

  res.json(formatOffer(offer));
});

/**
 * POST /marketplace/offers/:offer_id/accept
 * Accept an offer. Seller only, pending only.
 * For purchase/trade: no other accepted offer on listing.
 * For commission: multiple accepted offers allowed.
 */
offersRouter.post('/:offer_id/accept', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  const offerRows = await query<OfferRow & { seller_user_id: string }>(
    `SELECT o.*, l.seller_user_id
       FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE o.offer_id = $1`,
    [req.params.offer_id],
  );

  if (offerRows.length === 0) {
    res.status(404).json({ error: 'offer_not_found', message: 'Offer not found.' });
    return;
  }

  const offer = offerRows[0];

  // Rule: seller only
  if (offer.seller_user_id !== caller.user_id) {
    res.status(403).json({ error: 'forbidden', message: 'Only the seller can accept this offer.' });
    return;
  }

  // Rule: pending only
  if (offer.status !== 'pending') {
    res.status(400).json({ error: 'invalid_status', message: 'Only pending offers can be accepted.' });
    return;
  }

  // Rule: for purchase/trade, no other accepted offer on listing
  // Use transaction with FOR UPDATE to prevent concurrent accepts
  // Purchase/trade offers transition to 'awaiting_confirmation' state
  if (offer.offer_type !== 'commission') {
    try {
      const updated = await withTransaction(async (client) => {
        // Lock the listing row to prevent concurrent accepts
        await client.query('SELECT listing_id FROM listings WHERE listing_id = $1 FOR UPDATE', [
          offer.listing_id,
        ]);

        // Check for existing accepted/awaiting_confirmation offer (inside transaction)
        const existingAccepted = await client.query<{ offer_id: string }>(
          `SELECT offer_id FROM structured_offers
            WHERE listing_id = $1 AND status IN ('accepted', 'awaiting_confirmation') AND offer_id != $2`,
          [offer.listing_id, offer.offer_id],
        );

        if (existingAccepted.rows.length > 0) {
          throw new Error('CONFLICT');
        }

        // Accept offer - set to awaiting_confirmation for purchase/trade
        const result = await client.query<OfferRow>(
          `UPDATE structured_offers
              SET status = 'awaiting_confirmation', responded_at = NOW(), updated_at = NOW()
            WHERE offer_id = $1
            RETURNING *`,
          [req.params.offer_id],
        );

        return result.rows[0];
      });

      res.json(formatOffer(updated));
    } catch (error) {
      if (error instanceof Error && error.message === 'CONFLICT') {
        res.status(409).json({
          error: 'offer_already_accepted',
          message: 'Another offer is already accepted on this listing. One item can only be sold or traded once.',
        });
      } else {
        throw error;
      }
    }
  } else {
    // Commission: no conflict check needed, multiple accepts allowed, stays in 'accepted' status
    const updated = await query<OfferRow>(
      `UPDATE structured_offers
          SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
        WHERE offer_id = $1
        RETURNING *`,
      [req.params.offer_id],
    );

    res.json(formatOffer(updated[0]));
  }
});

/**
 * POST /marketplace/offers/:offer_id/decline
 * Decline an offer. Seller only, pending only.
 */
offersRouter.post('/:offer_id/decline', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  const offerRows = await query<OfferRow & { seller_user_id: string }>(
    `SELECT o.*, l.seller_user_id
       FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE o.offer_id = $1`,
    [req.params.offer_id],
  );

  if (offerRows.length === 0) {
    res.status(404).json({ error: 'offer_not_found', message: 'Offer not found.' });
    return;
  }

  const offer = offerRows[0];

  // Rule: seller only
  if (offer.seller_user_id !== caller.user_id) {
    res.status(403).json({ error: 'forbidden', message: 'Only the seller can decline this offer.' });
    return;
  }

  // Rule: pending only
  if (offer.status !== 'pending') {
    res.status(400).json({ error: 'invalid_status', message: 'Only pending offers can be declined.' });
    return;
  }

  // Decline offer
  const updated = await query<OfferRow>(
    `UPDATE structured_offers
        SET status = 'declined', responded_at = NOW(), updated_at = NOW()
      WHERE offer_id = $1
      RETURNING *`,
    [req.params.offer_id],
  );

  res.json(formatOffer(updated[0]));
});

/**
 * POST /marketplace/offers/:offer_id/withdraw
 * Withdraw an offer. Proposer only, pending only.
 */
offersRouter.post('/:offer_id/withdraw', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  const offerRows = await query<OfferRow>(
    'SELECT * FROM structured_offers WHERE offer_id = $1',
    [req.params.offer_id],
  );

  if (offerRows.length === 0) {
    res.status(404).json({ error: 'offer_not_found', message: 'Offer not found.' });
    return;
  }

  const offer = offerRows[0];

  // Rule: proposer only
  if (offer.proposer_user_id !== caller.user_id) {
    res.status(403).json({ error: 'forbidden', message: 'Only the proposer can withdraw this offer.' });
    return;
  }

  // Rule: pending only
  if (offer.status !== 'pending') {
    res.status(400).json({ error: 'invalid_status', message: 'Only pending offers can be withdrawn.' });
    return;
  }

  // Withdraw offer
  const updated = await query<OfferRow>(
    `UPDATE structured_offers
        SET status = 'withdrawn', responded_at = NOW(), updated_at = NOW()
      WHERE offer_id = $1
      RETURNING *`,
    [req.params.offer_id],
  );

  res.json(formatOffer(updated[0]));
});

/**
 * POST /marketplace/offers/:offer_id/confirm
 * Confirm readiness for item transfer (both buyer and seller must confirm).
 * When both parties confirm, ownership transfers and offer status becomes 'completed'.
 * Only applies to purchase/trade offers in 'awaiting_confirmation' status.
 * Commission offers skip this flow entirely.
 */
offersRouter.post('/:offer_id/confirm', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  try {
    await withTransaction(async (client) => {
      // Load offer with listing details
      const offerRows = await client.query<OfferRow & { seller_user_id: string; item_id: string | null }>(
        `SELECT o.*, l.seller_user_id, l.item_id
           FROM structured_offers o
           JOIN listings l ON l.listing_id = o.listing_id
          WHERE o.offer_id = $1
            FOR UPDATE OF o`,
        [req.params.offer_id],
      );

      if (offerRows.rows.length === 0) {
        res.status(404).json({ error: 'offer_not_found', message: 'Offer not found.' });
        return;
      }

      const offer = offerRows.rows[0];

      // Rule: only parties can confirm
      const isProposer = offer.proposer_user_id === caller.user_id;
      const isRecipient = offer.seller_user_id === caller.user_id;
      
      if (!isProposer && !isRecipient) {
        res.status(403).json({ error: 'forbidden', message: 'Only the buyer or seller can confirm this offer.' });
        return;
      }

      // Rule: only awaiting_confirmation offers can be confirmed
      if (offer.status !== 'awaiting_confirmation') {
        res.status(400).json({ 
          error: 'invalid_status', 
          message: 'Only offers in awaiting_confirmation status can be confirmed.' 
        });
        return;
      }

      // Rule: commission offers should not reach this endpoint
      if (offer.offer_type === 'commission') {
        res.status(400).json({ 
          error: 'invalid_offer_type', 
          message: 'Commission offers do not require confirmation.' 
        });
        return;
      }

      // Determine which party is confirming
      const confirmField = isProposer ? 'proposer_confirmed_at' : 'recipient_confirmed_at';
      const alreadyConfirmed = isProposer ? offer.proposer_confirmed_at : offer.recipient_confirmed_at;

      // Idempotent: if already confirmed, return success
      if (alreadyConfirmed) {
        res.json(formatOffer(offer));
        return;
      }

      // Set confirmation timestamp
      await client.query(
        `UPDATE structured_offers 
            SET ${confirmField} = NOW(), updated_at = NOW() 
          WHERE offer_id = $1`,
        [req.params.offer_id],
      );

      // Check if both parties have now confirmed
      const updatedOfferRows = await client.query<OfferRow & { seller_user_id: string; item_id: string | null }>(
        `SELECT o.*, l.seller_user_id, l.item_id
           FROM structured_offers o
           JOIN listings l ON l.listing_id = o.listing_id
          WHERE o.offer_id = $1`,
        [req.params.offer_id],
      );

      const updatedOffer = updatedOfferRows.rows[0];

      // If both confirmed, complete the offer (transfer ownership)
      if (updatedOffer.proposer_confirmed_at && updatedOffer.recipient_confirmed_at) {
        await completeOfferInternal(
          client,
          updatedOffer.offer_id,
          updatedOffer.item_id,
          updatedOffer.listing_id,
          updatedOffer.seller_user_id,
          updatedOffer.proposer_user_id,
        );

        // Reload to get updated status
        const finalOfferRows = await client.query<OfferRow>(
          'SELECT o.* FROM structured_offers o WHERE o.offer_id = $1',
          [req.params.offer_id],
        );

        res.json(formatOffer(finalOfferRows.rows[0]));
      } else {
        // Only one party confirmed so far
        res.json(formatOffer(updatedOffer));
      }
    });
  } catch (error) {
    console.error('Error confirming offer:', error);
    res.status(500).json({ error: 'server_error', message: 'Failed to confirm offer.' });
  }
});

/**
 * Internal function to complete an offer after both parties confirm.
 * Transfers item ownership from seller to buyer and marks offer as completed.
 */
async function completeOfferInternal(
  client: any,
  offerId: string,
  attireId: string | null,
  listingId: string,
  sellerUserId: string,
  buyerUserId: string,
): Promise<void> {
  // Defensive check: item_id should exist for purchase/trade offers
  if (!attireId) {
    throw new Error('Cannot complete offer: listing has no inventory item');
  }

  // Transfer ownership in owned_attire table
  await client.query(
    `UPDATE owned_attire
        SET user_id = $1,
            availability_status = 'free',
            updated_at = NOW()
      WHERE attire_id = $2`,
    [buyerUserId, attireId],
  );

  // Write ownership history
  await client.query(
    `INSERT INTO inventory_item_history (
      item_id, from_user_id, to_user_id, reason, listing_id, offer_id, transferred_at
    ) VALUES ($1, $2, $3, 'marketplace_sale', $4, $5, NOW())`,
    [attireId, sellerUserId, buyerUserId, listingId, offerId],
  );

  // Mark offer as completed
  await client.query(
    `UPDATE structured_offers
        SET status = 'completed', updated_at = NOW()
      WHERE offer_id = $1`,
    [offerId],
  );

  // Write audit events
  await client.query(
    `INSERT INTO audit_events (user_id, action, entity_type, entity_id, details, timestamp)
     VALUES ($1, 'complete', 'offer', $2, $3, NOW())`,
    [buyerUserId, offerId, JSON.stringify({ 
      action: 'offer_completed', 
      item_transferred: attireId,
      from_user: sellerUserId,
      to_user: buyerUserId 
    })],
  );
}

/**
 * Format offer row for API response. Never includes email addresses.
 */
function formatOffer(row: OfferRow): Record<string, any> {
  return {
    offer_id: row.offer_id,
    listing_id: row.listing_id,
    proposer_user_id: row.proposer_user_id,
    offer_type: row.offer_type,
    status: row.status,
    offered_price: row.offered_price ? parseFloat(row.offered_price) : null,
    trade_offered_item: row.trade_offered_item,
    trade_offered_condition: row.trade_offered_condition,
    trade_offered_est_value: row.trade_offered_est_value ? parseFloat(row.trade_offered_est_value) : null,
    commission_description: row.commission_description,
    timeline_days: row.commission_timeline_days,
    offer_notes: row.offer_notes,
    listing_title: row.listing_title,
    listing_price: row.listing_price ? parseFloat(row.listing_price) : null,
    proposer_display_name: row.proposer_display_name,
    seller_display_name: row.seller_display_name,
    proposer_confirmed_at: row.proposer_confirmed_at ? row.proposer_confirmed_at.toISOString() : null,
    recipient_confirmed_at: row.recipient_confirmed_at ? row.recipient_confirmed_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    responded_at: row.responded_at ? row.responded_at.toISOString() : null,
    updated_at: row.updated_at.toISOString(),
  };
}

export default offersRouter;

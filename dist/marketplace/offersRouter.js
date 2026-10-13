"use strict";
/**
 * Marketplace Offers Router
 *
 * Manages structured offers (purchase, trade, commission) on marketplace listings.
 * All business rules enforced server-side. Never returns email addresses.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_1 = require("../auth/session");
const db_1 = require("../db");
const rules_1 = require("./rules");
const offerRules_1 = require("./offerRules");
const offersRouter = (0, express_1.Router)();
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
offersRouter.post('/', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({
            error: 'marketplace_verification_required',
            message: 'You must be a verified marketplace participant to make offers.',
        });
        return;
    }
    const input = req.body;
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
    const listingRows = await (0, db_1.query)(`SELECT l.listing_id, l.seller_user_id, l.listing_status, l.category_id, l.item_title, l.price,
            u.seller_display_name
       FROM listings l
       JOIN users u ON u.user_id = l.seller_user_id
      WHERE l.listing_id = $1`, [input.listing_id]);
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
    const categoryRows = await (0, db_1.query)('SELECT category_name FROM permitted_categories WHERE category_id = $1', [listing.category_id]);
    const categoryName = categoryRows[0]?.category_name || '';
    if (!(0, offerRules_1.isOfferTypeAllowedForCategory)(categoryName, input.offer_type)) {
        res.status(400).json({
            error: 'offer_type_not_allowed',
            message: 'That offer type is not available for this listing category.',
        });
        return;
    }
    // Rule: no duplicate pending offer
    const existingRows = await (0, db_1.query)(`SELECT offer_id FROM structured_offers
      WHERE listing_id = $1 AND proposer_user_id = $2 AND status = 'pending'`, [input.listing_id, caller.user_id]);
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
    const offerRows = await (0, db_1.query)(`INSERT INTO structured_offers (
       listing_id, proposer_user_id, offer_type, status,
       offered_price, trade_offered_item, trade_offered_condition, trade_offered_est_value,
       commission_description, commission_timeline_days, offer_notes,
       listing_title, listing_price, proposer_display_name, seller_display_name
     ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`, [
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
    ]);
    res.status(201).json(formatOffer(offerRows[0]));
});
/**
 * GET /marketplace/offers/sent
 * List offers sent by the authenticated user.
 * Query params: ?status=pending|accepted|declined|withdrawn (optional)
 */
offersRouter.get('/sent', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    const statusFilter = req.query.status;
    let statusClause = '';
    const params = [caller.user_id];
    if (statusFilter && ['pending', 'accepted', 'declined', 'withdrawn'].includes(statusFilter)) {
        statusClause = ' AND status = $2';
        params.push(statusFilter);
    }
    const offers = await (0, db_1.query)(`SELECT * FROM structured_offers
      WHERE proposer_user_id = $1${statusClause}
      ORDER BY created_at DESC`, params);
    res.json({ offers: offers.map(formatOffer) });
});
/**
 * GET /marketplace/offers/received
 * List offers received on the authenticated user's listings.
 * Query params: ?listing_id=<uuid> (optional), ?status=... (optional)
 */
offersRouter.get('/received', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    const listingIdFilter = req.query.listing_id;
    const statusFilter = req.query.status;
    let whereClauses = ['l.seller_user_id = $1'];
    const params = [caller.user_id];
    if (listingIdFilter) {
        whereClauses.push(`o.listing_id = $${params.length + 1}`);
        params.push(listingIdFilter);
    }
    if (statusFilter && ['pending', 'accepted', 'declined', 'withdrawn'].includes(statusFilter)) {
        whereClauses.push(`o.status = $${params.length + 1}`);
        params.push(statusFilter);
    }
    const offers = await (0, db_1.query)(`SELECT o.* FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY o.created_at DESC`, params);
    res.json({ offers: offers.map(formatOffer) });
});
/**
 * GET /marketplace/offers/:offer_id
 * Get a single offer. User must be proposer or listing seller.
 */
offersRouter.get('/:offer_id', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    const offerRows = await (0, db_1.query)(`SELECT o.*, l.seller_user_id
       FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE o.offer_id = $1`, [req.params.offer_id]);
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
offersRouter.post('/:offer_id/accept', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    const offerRows = await (0, db_1.query)(`SELECT o.*, l.seller_user_id
       FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE o.offer_id = $1`, [req.params.offer_id]);
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
    if (offer.offer_type !== 'commission') {
        try {
            const updated = await (0, db_1.withTransaction)(async (client) => {
                // Lock the listing row to prevent concurrent accepts
                await client.query('SELECT listing_id FROM listings WHERE listing_id = $1 FOR UPDATE', [
                    offer.listing_id,
                ]);
                // Check for existing accepted offer (inside transaction)
                const existingAccepted = await client.query(`SELECT offer_id FROM structured_offers
            WHERE listing_id = $1 AND status = 'accepted' AND offer_id != $2`, [offer.listing_id, offer.offer_id]);
                if (existingAccepted.rows.length > 0) {
                    throw new Error('CONFLICT');
                }
                // Accept offer
                const result = await client.query(`UPDATE structured_offers
              SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
            WHERE offer_id = $1
            RETURNING *`, [req.params.offer_id]);
                return result.rows[0];
            });
            res.json(formatOffer(updated));
        }
        catch (error) {
            if (error instanceof Error && error.message === 'CONFLICT') {
                res.status(409).json({
                    error: 'offer_already_accepted',
                    message: 'Another offer is already accepted on this listing. One item can only be sold or traded once.',
                });
            }
            else {
                throw error;
            }
        }
    }
    else {
        // Commission: no conflict check needed, multiple accepts allowed
        const updated = await (0, db_1.query)(`UPDATE structured_offers
          SET status = 'accepted', responded_at = NOW(), updated_at = NOW()
        WHERE offer_id = $1
        RETURNING *`, [req.params.offer_id]);
        res.json(formatOffer(updated[0]));
    }
});
/**
 * POST /marketplace/offers/:offer_id/decline
 * Decline an offer. Seller only, pending only.
 */
offersRouter.post('/:offer_id/decline', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    const offerRows = await (0, db_1.query)(`SELECT o.*, l.seller_user_id
       FROM structured_offers o
       JOIN listings l ON l.listing_id = o.listing_id
      WHERE o.offer_id = $1`, [req.params.offer_id]);
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
    const updated = await (0, db_1.query)(`UPDATE structured_offers
        SET status = 'declined', responded_at = NOW(), updated_at = NOW()
      WHERE offer_id = $1
      RETURNING *`, [req.params.offer_id]);
    res.json(formatOffer(updated[0]));
});
/**
 * POST /marketplace/offers/:offer_id/withdraw
 * Withdraw an offer. Proposer only, pending only.
 */
offersRouter.post('/:offer_id/withdraw', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    const offerRows = await (0, db_1.query)('SELECT * FROM structured_offers WHERE offer_id = $1', [req.params.offer_id]);
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
    const updated = await (0, db_1.query)(`UPDATE structured_offers
        SET status = 'withdrawn', responded_at = NOW(), updated_at = NOW()
      WHERE offer_id = $1
      RETURNING *`, [req.params.offer_id]);
    res.json(formatOffer(updated[0]));
});
/**
 * Format offer row for API response. Never includes email addresses.
 */
function formatOffer(row) {
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
        created_at: row.created_at.toISOString(),
        responded_at: row.responded_at ? row.responded_at.toISOString() : null,
        updated_at: row.updated_at.toISOString(),
    };
}
exports.default = offersRouter;
//# sourceMappingURL=offersRouter.js.map
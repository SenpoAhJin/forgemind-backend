"use strict";
/**
 * Marketplace Chat Router
 *
 * One thread per (listing, buyer). Text-only messaging with send-time moderation.
 * Chat content is NEVER screened post-send, classified, scored, or used as AI input.
 *
 * RULES ENFORCED:
 * R1: Caller must be verified marketplace user
 * R2: Only buyer and seller can access thread
 * R3: Seller cannot start thread on own listing
 * R4: Thread creation only while listing is active
 * R5: Inactive listing reads as closed (listing_unavailable), computed on read, sending refused
 * R6: Closed threads never reopen
 * R7: Body trimmed, not empty, max 1000 chars, text only
 * R8: No email in responses (user_ids and display_names only)
 * R9: Message bodies never logged
 * R10: Blocked messages return 422, nothing saved/logged/hinted
 * R11: 401 without token, 400/404 for malformed/unknown ids, never 500
 * R12: All SQL parameterized
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_1 = require("../auth/session");
const db_1 = require("../db");
const rules_1 = require("./rules");
const chatModeration_1 = require("./chatModeration");
const chatRouter = (0, express_1.Router)();
/** Validate UUID format (R11) */
function isValidUuid(id) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}
/**
 * POST /marketplace/chat/threads
 * Body: { listing_id: string }
 *
 * Get-or-create thread for caller as buyer (INSERT ... ON CONFLICT).
 *
 * Enforces R1, R3, R4, R8, R11, R12
 */
chatRouter.post('/threads', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({ error: 'marketplace_verification_required' });
        return;
    }
    const { listing_id } = req.body;
    if (!listing_id || !isValidUuid(listing_id)) {
        res.status(400).json({ error: 'invalid_listing_id' });
        return;
    }
    try {
        // Check listing exists, is active, caller is not seller (R3, R4, R12)
        const listingRows = await (0, db_1.query)(`SELECT l.seller_user_id, l.item_title, l.listing_status, u.display_name as seller_display_name
       FROM listings l
       JOIN users u ON l.seller_user_id = u.user_id
       WHERE l.listing_id = $1`, [listing_id]);
        if (listingRows.length === 0) {
            res.status(404).json({ error: 'listing_not_found' });
            return;
        }
        const listing = listingRows[0];
        // R3: Seller cannot start thread on own listing
        if (listing.seller_user_id === session.user_id) {
            res.status(403).json({ error: 'cannot_message_own_listing' });
            return;
        }
        // R4: Listing must be active
        if (listing.listing_status !== 'active') {
            res.status(400).json({ error: 'listing_not_active' });
            return;
        }
        // Get-or-create thread (R12)
        const threadRows = await (0, db_1.query)(`INSERT INTO chat_threads (
         listing_id, buyer_user_id, seller_user_id,
         listing_title, seller_display_name, buyer_display_name
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (listing_id, buyer_user_id) DO UPDATE
         SET listing_id = EXCLUDED.listing_id
       RETURNING thread_id, listing_id, buyer_user_id, seller_user_id,
                 thread_status, closed_reason, closed_at, created_at,
                 listing_title, seller_display_name, buyer_display_name,
                 last_message_at, last_message_preview,
                 buyer_last_read_at, seller_last_read_at`, [
            listing_id,
            session.user_id,
            listing.seller_user_id,
            listing.item_title,
            listing.seller_display_name,
            session.display_name,
        ]);
        const thread = threadRows[0];
        // R8: No email in response
        res.status(200).json({
            thread_id: thread.thread_id,
            listing_id: thread.listing_id,
            listing_title: thread.listing_title,
            seller_user_id: thread.seller_user_id,
            seller_display_name: thread.seller_display_name,
            buyer_user_id: thread.buyer_user_id,
            buyer_display_name: thread.buyer_display_name,
            status: thread.thread_status,
            closed_reason: thread.closed_reason,
            closed_at: thread.closed_at,
            created_at: thread.created_at,
            last_message_at: thread.last_message_at,
            last_message_preview: thread.last_message_preview,
            buyer_last_read_at: thread.buyer_last_read_at,
            seller_last_read_at: thread.seller_last_read_at,
        });
    }
    catch (error) {
        console.error('Error creating thread:', error);
        res.status(500).json({ error: 'internal_error' });
    }
});
/**
 * GET /marketplace/chat/threads
 *
 * Caller's threads with at least one message, newest first.
 *
 * Enforces R1, R5, R8, R12
 */
chatRouter.get('/threads', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({ error: 'marketplace_verification_required' });
        return;
    }
    try {
        const threadRows = await (0, db_1.query)(`SELECT t.thread_id, t.listing_id, t.listing_title,
              t.seller_user_id, t.seller_display_name,
              t.buyer_user_id, t.buyer_display_name,
              t.thread_status, t.closed_reason, t.closed_at,
              t.created_at, t.last_message_at, t.last_message_preview,
              l.listing_status,
              CASE WHEN $1 = t.buyer_user_id THEN t.buyer_last_read_at
                   ELSE t.seller_last_read_at END as my_last_read_at
       FROM chat_threads t
       JOIN listings l ON t.listing_id = l.listing_id
       WHERE (t.buyer_user_id = $1 OR t.seller_user_id = $1)
         AND t.last_message_at IS NOT NULL
       ORDER BY t.last_message_at DESC NULLS LAST`, [session.user_id]);
        // R5: Compute effective status (listing_unavailable if listing not active)
        const threads = threadRows.map((row) => {
            const hasUnread = row.last_message_at &&
                (!row.my_last_read_at || new Date(row.last_message_at) > new Date(row.my_last_read_at));
            const effectiveStatus = row.listing_status !== 'active' ? 'closed' : row.thread_status;
            const effectiveClosed = row.listing_status !== 'active' ? 'listing_unavailable' : row.closed_reason;
            return {
                thread_id: row.thread_id,
                listing_id: row.listing_id,
                listing_title: row.listing_title,
                seller_user_id: row.seller_user_id,
                seller_display_name: row.seller_display_name,
                buyer_user_id: row.buyer_user_id,
                buyer_display_name: row.buyer_display_name,
                status: effectiveStatus,
                closed_reason: effectiveClosed,
                closed_at: row.closed_at,
                created_at: row.created_at,
                last_message_at: row.last_message_at,
                last_message_preview: row.last_message_preview,
                has_unread: hasUnread,
            };
        });
        res.status(200).json({ threads });
    }
    catch (error) {
        console.error('Error fetching threads:', error);
        res.status(500).json({ error: 'internal_error' });
    }
});
/**
 * GET /marketplace/chat/threads/:id
 *
 * Thread + messages. Participants only.
 *
 * Enforces R1, R2, R5, R8, R11, R12
 */
chatRouter.get('/threads/:id', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({ error: 'marketplace_verification_required' });
        return;
    }
    const { id } = req.params;
    if (!isValidUuid(id)) {
        res.status(400).json({ error: 'invalid_thread_id' });
        return;
    }
    try {
        // R2: Check participant (R12)
        const threadRows = await (0, db_1.query)(`SELECT t.thread_id, t.listing_id, t.listing_title,
              t.seller_user_id, t.seller_display_name,
              t.buyer_user_id, t.buyer_display_name,
              t.thread_status, t.closed_reason, t.closed_at, t.created_at,
              l.listing_status
       FROM chat_threads t
       JOIN listings l ON t.listing_id = l.listing_id
       WHERE t.thread_id = $1
         AND (t.buyer_user_id = $2 OR t.seller_user_id = $2)`, [id, session.user_id]);
        if (threadRows.length === 0) {
            res.status(404).json({ error: 'thread_not_found' });
            return;
        }
        const thread = threadRows[0];
        // Fetch messages (R12)
        const messageRows = await (0, db_1.query)(`SELECT m.message_id, m.thread_id, m.sender_user_id,
              m.message_text as body, m.created_at,
              u.display_name as sender_display_name
       FROM chat_messages m
       JOIN users u ON m.sender_user_id = u.user_id
       WHERE m.thread_id = $1
       ORDER BY m.created_at ASC`, [id]);
        // R5: Effective status
        const effectiveStatus = thread.listing_status !== 'active' ? 'closed' : thread.thread_status;
        const effectiveClosed = thread.listing_status !== 'active' ? 'listing_unavailable' : thread.closed_reason;
        // R8: No email
        res.status(200).json({
            thread: {
                thread_id: thread.thread_id,
                listing_id: thread.listing_id,
                listing_title: thread.listing_title,
                seller_user_id: thread.seller_user_id,
                seller_display_name: thread.seller_display_name,
                buyer_user_id: thread.buyer_user_id,
                buyer_display_name: thread.buyer_display_name,
                status: effectiveStatus,
                closed_reason: effectiveClosed,
                closed_at: thread.closed_at,
                created_at: thread.created_at,
            },
            messages: messageRows.map((msg) => ({
                message_id: msg.message_id,
                thread_id: msg.thread_id,
                sender_user_id: msg.sender_user_id,
                sender_display_name: msg.sender_display_name,
                body: msg.body,
                created_at: msg.created_at,
            })),
        });
    }
    catch (error) {
        console.error('Error fetching thread:', error);
        res.status(500).json({ error: 'internal_error' });
    }
});
/**
 * POST /marketplace/chat/threads/:id/messages
 * Body: { body: string }
 *
 * Send message. Screens at send-time.
 *
 * Enforces R1, R2, R5, R6, R7, R9, R10, R11, R12
 */
chatRouter.post('/threads/:id/messages', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({ error: 'marketplace_verification_required' });
        return;
    }
    const { id } = req.params;
    const rawBody = req.body.body;
    if (!isValidUuid(id)) {
        res.status(400).json({ error: 'invalid_thread_id' });
        return;
    }
    // R7: Body validation
    if (typeof rawBody !== 'string') {
        res.status(400).json({ error: 'body_required' });
        return;
    }
    const body = rawBody.trim();
    if (body.length === 0) {
        res.status(400).json({ error: 'body_empty' });
        return;
    }
    if (body.length > 1000) {
        res.status(400).json({ error: 'body_too_long', max_length: 1000 });
        return;
    }
    // R10: Screen message BEFORE saving (R9: never log body)
    const screenResult = (0, chatModeration_1.screenMessage)(body);
    if (screenResult.blocked) {
        res.status(422).json({
            error: 'message_blocked',
            message: "This message can't be sent. Please rephrase it.",
        });
        return;
    }
    try {
        // R2: Check thread, participant, and status (R12)
        const threadRows = await (0, db_1.query)(`SELECT t.thread_id, t.thread_status, t.closed_reason,
              t.buyer_user_id, t.seller_user_id, l.listing_status
       FROM chat_threads t
       JOIN listings l ON t.listing_id = l.listing_id
       WHERE t.thread_id = $1
         AND (t.buyer_user_id = $2 OR t.seller_user_id = $2)`, [id, session.user_id]);
        if (threadRows.length === 0) {
            res.status(404).json({ error: 'thread_not_found' });
            return;
        }
        const thread = threadRows[0];
        // R6: Closed threads never reopen
        if (thread.thread_status === 'closed') {
            res.status(400).json({ error: 'thread_closed', reason: thread.closed_reason });
            return;
        }
        // R5: Refuse sending if listing not active
        if (thread.listing_status !== 'active') {
            res.status(400).json({ error: 'listing_unavailable' });
            return;
        }
        // Insert message (R12)
        const messageRows = await (0, db_1.query)(`INSERT INTO chat_messages (thread_id, sender_user_id, message_text)
       VALUES ($1, $2, $3)
       RETURNING message_id, thread_id, sender_user_id, message_text as body, created_at`, [id, session.user_id, body]);
        const message = messageRows[0];
        // Update thread preview and last_message_at (R12)
        const preview = body.length > 60 ? body.substring(0, 60) : body;
        await (0, db_1.query)(`UPDATE chat_threads
       SET last_message_at = $1, last_message_preview = $2
       WHERE thread_id = $3`, [message.created_at, preview, id]);
        // Update sender's last_read_at (R12)
        const isBuyer = thread.buyer_user_id === session.user_id;
        await (0, db_1.query)(isBuyer
            ? `UPDATE chat_threads SET buyer_last_read_at = $1 WHERE thread_id = $2`
            : `UPDATE chat_threads SET seller_last_read_at = $1 WHERE thread_id = $2`, [message.created_at, id]);
        res.status(201).json({
            message_id: message.message_id,
            thread_id: message.thread_id,
            sender_user_id: message.sender_user_id,
            body: message.body,
            created_at: message.created_at,
        });
    }
    catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'internal_error' });
    }
});
/**
 * POST /marketplace/chat/threads/:id/close
 *
 * Close thread manually.
 *
 * Enforces R1, R2, R6, R11, R12
 */
chatRouter.post('/threads/:id/close', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({ error: 'marketplace_verification_required' });
        return;
    }
    const { id } = req.params;
    if (!isValidUuid(id)) {
        res.status(400).json({ error: 'invalid_thread_id' });
        return;
    }
    try {
        // R2, R6: Only open threads by participants can be closed (R12)
        const result = await (0, db_1.query)(`UPDATE chat_threads
       SET thread_status = 'closed',
           closed_reason = 'closed_by_participant',
           closed_at = NOW(),
           closed_by_user_id = $2
       WHERE thread_id = $1
         AND (buyer_user_id = $2 OR seller_user_id = $2)
         AND thread_status = 'open'
       RETURNING thread_id`, [id, session.user_id]);
        if (result.length === 0) {
            // Check if thread exists and is accessible
            const checkRows = await (0, db_1.query)(`SELECT thread_id, thread_status
         FROM chat_threads
         WHERE thread_id = $1 AND (buyer_user_id = $2 OR seller_user_id = $2)`, [id, session.user_id]);
            if (checkRows.length === 0) {
                res.status(404).json({ error: 'thread_not_found' });
                return;
            }
            if (checkRows[0].thread_status === 'closed') {
                res.status(400).json({ error: 'thread_already_closed' });
                return;
            }
        }
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error closing thread:', error);
        res.status(500).json({ error: 'internal_error' });
    }
});
/**
 * POST /marketplace/chat/threads/:id/read
 *
 * Mark thread as read by caller.
 *
 * Enforces R1, R2, R11, R12
 */
chatRouter.post('/threads/:id/read', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({ error: 'marketplace_verification_required' });
        return;
    }
    const { id } = req.params;
    if (!isValidUuid(id)) {
        res.status(400).json({ error: 'invalid_thread_id' });
        return;
    }
    try {
        // R2: Check participant (R12)
        const threadRows = await (0, db_1.query)(`SELECT buyer_user_id, seller_user_id
       FROM chat_threads
       WHERE thread_id = $1 AND (buyer_user_id = $2 OR seller_user_id = $2)`, [id, session.user_id]);
        if (threadRows.length === 0) {
            res.status(404).json({ error: 'thread_not_found' });
            return;
        }
        const thread = threadRows[0];
        const isBuyer = thread.buyer_user_id === session.user_id;
        await (0, db_1.query)(isBuyer
            ? `UPDATE chat_threads SET buyer_last_read_at = NOW() WHERE thread_id = $1`
            : `UPDATE chat_threads SET seller_last_read_at = NOW() WHERE thread_id = $1`, [id]);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error('Error marking thread read:', error);
        res.status(500).json({ error: 'internal_error' });
    }
});
/**
 * GET /marketplace/chat/unread-count
 *
 * Total unread threads for caller.
 *
 * Enforces R1, R12
 */
chatRouter.get('/unread-count', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const caller = await (0, rules_1.requireMarketplaceUser)(req, res);
    if (!caller)
        return;
    if (!(0, rules_1.isVerifiedMarketplaceUser)(caller)) {
        res.status(403).json({ error: 'marketplace_verification_required' });
        return;
    }
    try {
        const countRows = await (0, db_1.query)(`SELECT COUNT(*) as unread_count
       FROM chat_threads t
       WHERE (t.buyer_user_id = $1 OR t.seller_user_id = $1)
         AND t.last_message_at IS NOT NULL
         AND (
           (t.buyer_user_id = $1 AND (t.buyer_last_read_at IS NULL OR t.last_message_at > t.buyer_last_read_at))
           OR
           (t.seller_user_id = $1 AND (t.seller_last_read_at IS NULL OR t.last_message_at > t.seller_last_read_at))
         )`, [session.user_id]);
        res.status(200).json({ unread_count: parseInt(countRows[0].unread_count, 10) });
    }
    catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ error: 'internal_error' });
    }
});
exports.default = chatRouter;
//# sourceMappingURL=chatRouter.js.map
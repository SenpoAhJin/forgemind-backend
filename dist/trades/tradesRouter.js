"use strict";
/**
 * Trades Router - M1 Trade Endpoints
 *
 * User-to-user trade operations (swap, sale).
 * All business rules enforced server-side.
 * Acting user always comes from session, never request body.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_1 = require("../auth/session");
const db_1 = require("../db");
const tradeService_1 = require("./tradeService");
const settingsService_1 = require("../settings/settingsService");
const tradesRouter = (0, express_1.Router)();
tradesRouter.post('/', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const body = req.body;
    // Validate input
    if (!body.recipient_id || typeof body.recipient_id !== 'string') {
        res.status(400).json({ error: 'invalid_input', message: 'recipient_id is required' });
        return;
    }
    if (!body.type || !['swap', 'sale'].includes(body.type)) {
        res.status(400).json({ error: 'invalid_input', message: 'type must be swap or sale' });
        return;
    }
    if (!Array.isArray(body.offered_item_ids)) {
        res.status(400).json({ error: 'invalid_input', message: 'offered_item_ids must be an array' });
        return;
    }
    if (!Array.isArray(body.requested_item_ids)) {
        res.status(400).json({ error: 'invalid_input', message: 'requested_item_ids must be an array' });
        return;
    }
    try {
        const tradeId = await (0, tradeService_1.proposeTrade)({
            proposer_id: session.user_id,
            recipient_id: body.recipient_id,
            type: body.type,
            offered_item_ids: body.offered_item_ids,
            requested_item_ids: body.requested_item_ids,
            note: body.note,
        });
        res.status(201).json({ trade_id: tradeId });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
tradesRouter.get('/', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    // Filters
    const role = req.query.role; // 'proposer' | 'recipient' | undefined (both)
    const state = req.query.state; // 'proposed' | 'accepted' | 'completed' | etc.
    // Lazy expiry: expire stale trades before listing
    await (0, tradeService_1.expireStaleTrades)();
    try {
        let sql = `
      SELECT
        t.id,
        t.proposer_id,
        t.recipient_id,
        t.type,
        t.state,
        t.proposer_confirmed_at,
        t.recipient_confirmed_at,
        t.accepted_at,
        t.expires_at,
        t.note,
        t.created_at,
        t.updated_at,
        prop.display_name as proposer_display_name,
        rec.display_name as recipient_display_name,
        (SELECT COUNT(*) FROM trade_items WHERE trade_id = t.id) as item_count
      FROM trades t
      LEFT JOIN users prop ON t.proposer_id = prop.user_id
      LEFT JOIN users rec ON t.recipient_id = rec.user_id
      WHERE 1=1
    `;
        const params = [];
        let paramIndex = 1;
        // Role filter
        if (role === 'proposer') {
            sql += ` AND t.proposer_id = $${paramIndex}`;
            params.push(session.user_id);
            paramIndex++;
        }
        else if (role === 'recipient') {
            sql += ` AND t.recipient_id = $${paramIndex}`;
            params.push(session.user_id);
            paramIndex++;
        }
        else {
            // Both roles (default)
            sql += ` AND (t.proposer_id = $${paramIndex} OR t.recipient_id = $${paramIndex})`;
            params.push(session.user_id);
            paramIndex++;
        }
        // State filter
        if (state) {
            sql += ` AND t.state = $${paramIndex}`;
            params.push(state);
            paramIndex++;
        }
        sql += ` ORDER BY t.created_at DESC`;
        const trades = await (0, db_1.query)(sql, params);
        res.json({
            trades: trades.map((t) => ({
                id: t.id,
                proposer_id: t.proposer_id,
                recipient_id: t.recipient_id,
                type: t.type,
                state: t.state,
                proposer_confirmed_at: t.proposer_confirmed_at,
                recipient_confirmed_at: t.recipient_confirmed_at,
                accepted_at: t.accepted_at,
                expires_at: t.expires_at,
                note: t.note,
                created_at: t.created_at,
                updated_at: t.updated_at,
                proposer_display_name: t.proposer_display_name,
                recipient_display_name: t.recipient_display_name,
                item_count: parseInt(String(t.item_count)),
            })),
        });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
tradesRouter.get('/:id', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const tradeId = req.params.id;
    try {
        const tradeRows = await (0, db_1.query)(`SELECT * FROM trades WHERE id = $1`, [tradeId]);
        if (tradeRows.length === 0) {
            res.status(404).json({ error: 'not_found', message: 'Trade not found' });
            return;
        }
        const trade = tradeRows[0];
        // Access control: only parties can view
        if (trade.proposer_id !== session.user_id && trade.recipient_id !== session.user_id) {
            res.status(404).json({ error: 'not_found', message: 'Trade not found' });
            return;
        }
        // Get items
        const items = await (0, db_1.query)(`SELECT * FROM trade_items WHERE trade_id = $1 ORDER BY from_user_id, item_id`, [tradeId]);
        res.json({
            trade: {
                id: trade.id,
                proposer_id: trade.proposer_id,
                recipient_id: trade.recipient_id,
                type: trade.type,
                state: trade.state,
                proposer_confirmed_at: trade.proposer_confirmed_at,
                recipient_confirmed_at: trade.recipient_confirmed_at,
                accepted_at: trade.accepted_at,
                expires_at: trade.expires_at,
                note: trade.note,
                version: trade.version,
                created_at: trade.created_at,
                updated_at: trade.updated_at,
            },
            items: items.map((item) => ({
                id: item.id,
                item_id: item.item_id,
                from_user_id: item.from_user_id,
                to_user_id: item.to_user_id,
            })),
        });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// POST /trades/:id/accept - Accept trade (recipient only)
// ============================================================================
tradesRouter.post('/:id/accept', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const tradeId = req.params.id;
    try {
        await (0, tradeService_1.acceptTrade)(tradeId, session.user_id);
        res.json({ success: true, message: 'Trade accepted' });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// POST /trades/:id/decline - Decline trade (recipient only)
// ============================================================================
tradesRouter.post('/:id/decline', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const tradeId = req.params.id;
    const reason = req.body.reason;
    try {
        await (0, tradeService_1.declineTrade)(tradeId, session.user_id, reason);
        res.json({ success: true, message: 'Trade declined' });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// POST /trades/:id/cancel - Cancel trade
// ============================================================================
tradesRouter.post('/:id/cancel', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const tradeId = req.params.id;
    const reason = req.body.reason;
    try {
        await (0, tradeService_1.cancelTrade)(tradeId, session.user_id, reason);
        res.json({ success: true, message: 'Trade cancelled' });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// POST /trades/:id/confirm - Confirm handoff
// ============================================================================
tradesRouter.post('/:id/confirm', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    const tradeId = req.params.id;
    try {
        await (0, tradeService_1.confirmTrade)(tradeId, session.user_id);
        res.json({ success: true, message: 'Handoff confirmed' });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// GET /settings/trade - Get trade settings (any logged-in user)
// ============================================================================
tradesRouter.get('/settings/trade', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        const settings = await (0, settingsService_1.listAllSettings)();
        const tradeSettings = settings.filter((s) => s.key.startsWith('trade.'));
        res.json({
            settings: tradeSettings.map((s) => ({
                key: s.key,
                value: s.value,
                value_type: s.value_type,
                description: s.description,
                min_value: s.min_value,
                max_value: s.max_value,
            })),
        });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// GET /admin/settings - Get all settings (Holder only)
// ============================================================================
tradesRouter.get('/admin/settings', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    // Check if user is Holder-verified
    const userRows = await (0, db_1.query)(`SELECT is_holder_verified, verification_status FROM users WHERE user_id = $1`, [session.user_id]);
    if (userRows.length === 0) {
        res.status(403).json({ error: 'forbidden', message: 'User not found' });
        return;
    }
    const user = userRows[0];
    if (!user.is_holder_verified || user.verification_status !== 'verified') {
        res.status(403).json({ error: 'forbidden', message: 'Holder verification required' });
        return;
    }
    try {
        const settings = await (0, settingsService_1.listAllSettings)();
        res.json({
            settings: settings.map((s) => ({
                key: s.key,
                value: s.value,
                value_type: s.value_type,
                description: s.description,
                min_value: s.min_value,
                max_value: s.max_value,
                version: s.version,
                updated_at: s.updated_at,
            })),
        });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// PUT /admin/settings/:key - Update a setting (Holder only)
// ============================================================================
tradesRouter.put('/admin/settings/:key', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    // Check if user is Holder-verified
    const userRows = await (0, db_1.query)(`SELECT is_holder_verified, verification_status FROM users WHERE user_id = $1`, [session.user_id]);
    if (userRows.length === 0) {
        res.status(403).json({ error: 'forbidden', message: 'User not found' });
        return;
    }
    const user = userRows[0];
    if (!user.is_holder_verified || user.verification_status !== 'verified') {
        res.status(403).json({ error: 'forbidden', message: 'Holder verification required' });
        return;
    }
    const key = req.params.key;
    const { value } = req.body;
    if (value === undefined) {
        res.status(400).json({ error: 'invalid_input', message: 'value is required' });
        return;
    }
    try {
        // Get old value for audit
        const oldValue = await (0, settingsService_1.getSetting)(key);
        // Update setting
        const result = await (0, settingsService_1.updateSetting)(key, value, session.user_id);
        if (!result.success) {
            res.status(400).json({ error: 'validation_failed', message: result.error });
            return;
        }
        // Write audit event
        await (0, db_1.query)(`INSERT INTO audit_events (actor_user_id, entity_type, entity_id, action, details)
       VALUES ($1, $2, $3, $4, $5)`, [
            session.user_id,
            'app_setting',
            key,
            'update',
            JSON.stringify({ old_value: oldValue, new_value: value }),
        ]);
        res.json({ success: true, message: 'Setting updated' });
    }
    catch (err) {
        handleTradeError(err, res);
    }
});
// ============================================================================
// Error Handler
// ============================================================================
function handleTradeError(err, res) {
    if (err instanceof tradeService_1.TradeNotFoundError) {
        res.status(404).json({ error: 'not_found', message: err.message });
    }
    else if (err instanceof tradeService_1.InvalidTransitionError) {
        res.status(409).json({ error: 'invalid_transition', message: err.message });
    }
    else if (err instanceof tradeService_1.ValidationError) {
        res.status(400).json({ error: 'validation_failed', message: err.message });
    }
    else if (err instanceof tradeService_1.ForbiddenError) {
        res.status(403).json({ error: 'forbidden', message: err.message });
    }
    else {
        console.error('[tradesRouter] Unexpected error:', err);
        res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
    }
}
exports.default = tradesRouter;
//# sourceMappingURL=tradesRouter.js.map
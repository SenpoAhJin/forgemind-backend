"use strict";
/**
 * Marketplace Strike System
 *
 * Tracks moderation violations and enforces posting penalties.
 * Strikes accumulate when content is blocked by moderation (text or image).
 * Penalties: strikes 1-4 lock posting for 10 minutes, strike 5 locks for 7 days,
 * strike 6+ bans the account.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BAN_AT_STRIKE = exports.STRIKE_5_LOCK_DAYS = exports.STRIKE_LOCK_MINUTES = void 0;
exports.assertCanPost = assertCanPost;
exports.recordViolation = recordViolation;
const db_1 = require("../db");
// Penalty schedule
exports.STRIKE_LOCK_MINUTES = 10;
exports.STRIKE_5_LOCK_DAYS = 7;
exports.BAN_AT_STRIKE = 6;
/**
 * Check if user can post a listing.
 * Returns ok, or locked with expiry, or banned.
 * Lazy expiry: expired locks are treated as cleared.
 */
async function assertCanPost(userId) {
    const result = await db_1.pool.query(`SELECT posting_locked_until, banned_at 
     FROM marketplace_user_status 
     WHERE user_id = $1`, [userId]);
    if (result.rows.length === 0) {
        return { ok: true };
    }
    const row = result.rows[0];
    // Banned is permanent
    if (row.banned_at) {
        return { banned: true };
    }
    // Lazy expiry: if lock time is in the future, locked
    if (row.posting_locked_until) {
        const lockTime = new Date(row.posting_locked_until);
        if (lockTime > new Date()) {
            return { locked: true, locked_until: lockTime };
        }
    }
    return { ok: true };
}
/**
 * Record a moderation violation and apply penalty.
 * Runs in a transaction with row lock to serialize concurrent violations.
 * Returns strike count, action taken, lock time if applicable, and next penalty.
 */
async function recordViolation(userId, kind, code, listingId) {
    const client = await db_1.pool.connect();
    try {
        await client.query('BEGIN');
        // Lock the user status row (or create if doesn't exist)
        const statusResult = await client.query(`INSERT INTO marketplace_user_status (user_id, strike_count, updated_at)
       VALUES ($1, 0, NOW())
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING user_id, strike_count, banned_at`, [userId]);
        // Lock for concurrent writes
        await client.query(`SELECT * FROM marketplace_user_status WHERE user_id = $1 FOR UPDATE`, [userId]);
        const currentCount = statusResult.rows[0].strike_count;
        const isBanned = statusResult.rows[0].banned_at !== null;
        // If already banned, don't add another strike
        if (isBanned) {
            await client.query('COMMIT');
            return {
                strike_count: currentCount,
                action: 'none',
                next_penalty: 'ban',
            };
        }
        // Insert the strike record
        await client.query(`INSERT INTO marketplace_strikes (user_id, kind, code, listing_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())`, [userId, kind, code, listingId || null]);
        // Increment strike count
        const newCount = currentCount + 1;
        // Determine penalty
        let action = 'none';
        let lockedUntil;
        let nextPenalty;
        if (newCount >= exports.BAN_AT_STRIKE) {
            // Ban the account
            action = 'ban';
            await client.query(`UPDATE marketplace_user_status
         SET strike_count = $1,
             banned_at = NOW(),
             ban_reason = 'repeated_violations',
             posting_locked_until = NULL,
             updated_at = NOW()
         WHERE user_id = $2`, [newCount, userId]);
            // Block all active listings
            await client.query(`UPDATE listings
         SET status = 'blocked',
             blocked_at = NOW(),
             blocked_reason = 'account_banned'
         WHERE seller_user_id = $1 AND status = 'active'`, [userId]);
            // Delete user sessions
            await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
            nextPenalty = 'ban';
        }
        else if (newCount === 5) {
            // 7-day lock
            action = 'lock';
            lockedUntil = new Date(Date.now() + exports.STRIKE_5_LOCK_DAYS * 24 * 60 * 60 * 1000);
            await client.query(`UPDATE marketplace_user_status
         SET strike_count = $1,
             posting_locked_until = $2,
             updated_at = NOW()
         WHERE user_id = $3`, [newCount, lockedUntil, userId]);
            nextPenalty = 'ban';
        }
        else {
            // 10-minute lock (strikes 1-4)
            action = 'lock';
            lockedUntil = new Date(Date.now() + exports.STRIKE_LOCK_MINUTES * 60 * 1000);
            await client.query(`UPDATE marketplace_user_status
         SET strike_count = $1,
             posting_locked_until = $2,
             updated_at = NOW()
         WHERE user_id = $3`, [newCount, lockedUntil, userId]);
            nextPenalty = newCount === 4 ? 'lock_7d' : 'lock_10m';
        }
        await client.query('COMMIT');
        return {
            strike_count: newCount,
            action,
            locked_until: lockedUntil,
            next_penalty: nextPenalty,
        };
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=strikes.js.map
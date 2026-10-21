/**
 * Trade Service - M1 Trade State Machine
 *
 * Server-side item ownership and user-to-user trade logic.
 * All transitions run in a single transaction with row locking.
 * Every transition writes to both trade_events and audit_events.
 *
 * State transitions:
 *   proposed -> accepted (recipient), declined (recipient), cancelled (proposer)
 *   accepted -> cancelled (either party), completed (system when both confirmed)
 *   proposed|accepted -> expired (system)
 *
 * Terminal states: declined, cancelled, expired, completed
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../db';
import {
  getNumberSetting,
  getArraySetting,
} from '../settings/settingsService';

// ============================================================================
// Types
// ============================================================================

export interface TradeProposal {
  proposer_id: string;
  recipient_id: string;
  type: 'swap' | 'sale';
  offered_item_ids: string[]; // Items proposer offers
  requested_item_ids: string[]; // Items proposer wants from recipient
  note?: string;
}

export interface Trade {
  id: string;
  listing_id: string | null;
  proposer_id: string;
  recipient_id: string;
  type: 'swap' | 'sale';
  state: 'proposed' | 'accepted' | 'completed' | 'declined' | 'cancelled' | 'expired';
  proposer_confirmed_at: Date | null;
  recipient_confirmed_at: Date | null;
  accepted_at: Date | null;
  expires_at: Date;
  note: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface TradeItem {
  id: string;
  trade_id: string;
  item_id: string;
  from_user_id: string;
  to_user_id: string;
}

interface OwnedItem {
  attire_id: string;
  user_id: string;
  availability_status: 'free' | 'committed' | 'reserved';
  reserved_trade_id: string | null;
}

interface UserVerification {
  user_id: string;
  is_holder_verified: boolean;
  verification_status: string;
}

// ============================================================================
// Validation Errors
// ============================================================================

export class TradeNotFoundError extends Error {
  constructor(tradeId: string) {
    super(`Trade ${tradeId} not found`);
    this.name = 'TradeNotFoundError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidTransitionError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

// ============================================================================
// Propose Trade
// ============================================================================

/**
 * Create a new trade proposal.
 * Validates: user verification, ownership, item availability, limits.
 * Does NOT reserve items (reservation happens on accept).
 */
export async function proposeTrade(proposal: TradeProposal): Promise<string> {
  return await withTransaction(async (client) => {
    // 1. Load settings
    const maxItemsPerSide = await getNumberSetting('trade.max_items_per_side');
    const maxActiveTrades = await getNumberSetting('trade.max_active_trades_per_user');
    const allowedTypes = await getArraySetting<string>('trade.allowed_types');
    const expiryHours = await getNumberSetting('trade.offer_expiry_hours');

    // 2. Validate basic constraints
    if (proposal.proposer_id === proposal.recipient_id) {
      throw new ValidationError('Cannot propose trade to yourself');
    }

    if (!allowedTypes.includes(proposal.type)) {
      throw new ValidationError(`Trade type "${proposal.type}" not allowed`);
    }

    if (proposal.offered_item_ids.length > maxItemsPerSide) {
      throw new ValidationError(`Cannot offer more than ${maxItemsPerSide} items`);
    }

    if (proposal.requested_item_ids.length > maxItemsPerSide) {
      throw new ValidationError(`Cannot request more than ${maxItemsPerSide} items`);
    }

    if (proposal.type === 'swap') {
      if (proposal.offered_item_ids.length === 0 || proposal.requested_item_ids.length === 0) {
        throw new ValidationError('Swap trade requires items on both sides');
      }
    }

    if (proposal.type === 'sale') {
      const totalItems = proposal.offered_item_ids.length + proposal.requested_item_ids.length;
      if (totalItems === 0 || (proposal.offered_item_ids.length > 0 && proposal.requested_item_ids.length > 0)) {
        throw new ValidationError('Sale trade requires items on exactly one side');
      }
    }

    // 3. Check both users are Holder-verified
    const users = await client.query<UserVerification>(
      `SELECT user_id, is_holder_verified, verification_status
         FROM users
        WHERE user_id = ANY($1::uuid[])`,
      [[proposal.proposer_id, proposal.recipient_id]],
    );

    if (users.rows.length !== 2) {
      throw new ValidationError('One or both users do not exist');
    }

    for (const user of users.rows) {
      if (!user.is_holder_verified || user.verification_status !== 'verified') {
        throw new ValidationError('Both users must be Holder-verified');
      }
    }

    // 4. Check proposer active trade count
    const activeTradesResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count
         FROM trades
        WHERE (proposer_id = $1 OR recipient_id = $1)
          AND state IN ('proposed', 'accepted')`,
      [proposal.proposer_id],
    );

    if (parseInt(activeTradesResult.rows[0].count) >= maxActiveTrades) {
      throw new ValidationError(`Proposer has reached maximum of ${maxActiveTrades} active trades`);
    }

    // 5. Verify ownership and availability of all items (no locks - items not reserved yet)
    const allItemIds = [...proposal.offered_item_ids, ...proposal.requested_item_ids];
    
    if (allItemIds.length > 0) {
      const items = await client.query<OwnedItem>(
        `SELECT attire_id, user_id, availability_status, reserved_trade_id
           FROM owned_attire
          WHERE attire_id = ANY($1::uuid[])`,
        [allItemIds],
      );

      if (items.rows.length !== allItemIds.length) {
        throw new ValidationError('One or more items do not exist');
      }

      for (const itemId of proposal.offered_item_ids) {
        const item = items.rows.find((i) => i.attire_id === itemId);
        if (!item) continue;

        if (item.user_id !== proposal.proposer_id) {
          throw new ValidationError(`Item ${itemId} is not owned by proposer`);
        }

        if (item.availability_status !== 'free') {
          throw new ValidationError(`Item ${itemId} is not available`);
        }
      }

      for (const itemId of proposal.requested_item_ids) {
        const item = items.rows.find((i) => i.attire_id === itemId);
        if (!item) continue;

        if (item.user_id !== proposal.recipient_id) {
          throw new ValidationError(`Item ${itemId} is not owned by recipient`);
        }

        if (item.availability_status !== 'free') {
          throw new ValidationError(`Item ${itemId} is not available`);
        }
      }
    }

    // 6. Create trade record
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiryHours);

    const tradeResult = await client.query<{ id: string }>(
      `INSERT INTO trades (proposer_id, recipient_id, type, state, expires_at, note)
       VALUES ($1, $2, $3, 'proposed', $4, $5)
       RETURNING id`,
      [proposal.proposer_id, proposal.recipient_id, proposal.type, expiresAt, proposal.note || null],
    );

    const tradeId = tradeResult.rows[0].id;

    // 7. Insert trade_items
    for (const itemId of proposal.offered_item_ids) {
      await client.query(
        `INSERT INTO trade_items (trade_id, item_id, from_user_id, to_user_id)
         VALUES ($1, $2, $3, $4)`,
        [tradeId, itemId, proposal.proposer_id, proposal.recipient_id],
      );
    }

    for (const itemId of proposal.requested_item_ids) {
      await client.query(
        `INSERT INTO trade_items (trade_id, item_id, from_user_id, to_user_id)
         VALUES ($1, $2, $3, $4)`,
        [tradeId, itemId, proposal.recipient_id, proposal.proposer_id],
      );
    }

    // 8. Write trade_events and audit_events
    await writeTradeEvent(client, tradeId, proposal.proposer_id, null, 'proposed', 'Trade proposed');
    await writeAuditEvent(client, proposal.proposer_id, 'trade', tradeId, 'create', {
      type: proposal.type,
      offered_count: proposal.offered_item_ids.length,
      requested_count: proposal.requested_item_ids.length,
    });

    return tradeId;
  });
}

// ============================================================================
// Accept Trade
// ============================================================================

/**
 * Accept a proposed trade (recipient only).
 * Re-validates ownership/availability under lock, reserves items.
 * Cancels other proposed trades containing the same items.
 */
export async function acceptTrade(tradeId: string, actorId: string): Promise<void> {
  await withTransaction(async (client) => {
    // 1. Lock trade row
    const trades = await client.query<Trade>(
      `SELECT * FROM trades WHERE id = $1 FOR UPDATE`,
      [tradeId],
    );

    if (trades.rows.length === 0) {
      throw new TradeNotFoundError(tradeId);
    }

    const trade = trades.rows[0];

    // 2. Verify actor is recipient
    if (trade.recipient_id !== actorId) {
      throw new ForbiddenError('Only recipient can accept this trade');
    }

    // 3. Verify state
    if (trade.state !== 'proposed') {
      throw new InvalidTransitionError(`Cannot accept trade in state "${trade.state}"`);
    }

    // 4. Lock all items in ID order (to prevent deadlocks)
    const tradeItems = await client.query<TradeItem>(
      `SELECT * FROM trade_items WHERE trade_id = $1 ORDER BY item_id`,
      [tradeId],
    );

    const itemIds = tradeItems.rows.map((ti) => ti.item_id);

    if (itemIds.length > 0) {
      const items = await client.query<OwnedItem>(
        `SELECT attire_id, user_id, availability_status, reserved_trade_id
           FROM owned_attire
          WHERE attire_id = ANY($1::uuid[])
          ORDER BY attire_id
            FOR UPDATE`,
        [itemIds],
      );

      // 5. Re-validate ownership and availability under lock
      for (const ti of tradeItems.rows) {
        const item = items.rows.find((i) => i.attire_id === ti.item_id);
        if (!item) {
          throw new ValidationError(`Item ${ti.item_id} no longer exists`);
        }

        if (item.user_id !== ti.from_user_id) {
          throw new ValidationError(`Item ${ti.item_id} ownership changed`);
        }

        if (item.availability_status !== 'free') {
          throw new InvalidTransitionError(`Item ${ti.item_id} is no longer available`);
        }
      }

      // 6. Reserve all items
      await client.query(
        `UPDATE owned_attire
            SET availability_status = 'reserved',
                reserved_trade_id = $1
          WHERE attire_id = ANY($2::uuid[])`,
        [tradeId, itemIds],
      );
    }

    // 7. Update trade state
    const confirmWindowHours = await getNumberSetting('trade.confirm_window_hours');
    const newExpiresAt = new Date();
    newExpiresAt.setHours(newExpiresAt.getHours() + confirmWindowHours);

    await client.query(
      `UPDATE trades
          SET state = 'accepted',
              accepted_at = NOW(),
              expires_at = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [newExpiresAt, tradeId],
    );

    // 8. Cancel other proposed trades containing these items
    if (itemIds.length > 0) {
      const otherTradesResult = await client.query<{ id: string }>(
        `SELECT DISTINCT t.id
           FROM trades t
           JOIN trade_items ti ON t.id = ti.trade_id
          WHERE ti.item_id = ANY($1::uuid[])
            AND t.id <> $2
            AND t.state = 'proposed'
            FOR UPDATE OF t`,
        [itemIds, tradeId],
      );

      for (const row of otherTradesResult.rows) {
        await cancelTradeInternal(client, row.id, null, 'Item no longer available');
      }
    }

    // 9. Write events
    await writeTradeEvent(client, tradeId, actorId, 'proposed', 'accepted', 'Trade accepted');
    await writeAuditEvent(client, actorId, 'trade', tradeId, 'update', {
      action: 'accept',
      items_reserved: itemIds.length,
    });
  });
}

// ============================================================================
// Decline Trade
// ============================================================================

/**
 * Decline a proposed trade (recipient only).
 * No items were reserved, so just mark declined.
 */
export async function declineTrade(tradeId: string, actorId: string, reason?: string): Promise<void> {
  await withTransaction(async (client) => {
    const trades = await client.query<Trade>(
      `SELECT * FROM trades WHERE id = $1 FOR UPDATE`,
      [tradeId],
    );

    if (trades.rows.length === 0) {
      throw new TradeNotFoundError(tradeId);
    }

    const trade = trades.rows[0];

    if (trade.recipient_id !== actorId) {
      throw new ForbiddenError('Only recipient can decline this trade');
    }

    if (trade.state !== 'proposed') {
      throw new InvalidTransitionError(`Cannot decline trade in state "${trade.state}"`);
    }

    await client.query(
      `UPDATE trades SET state = 'declined', updated_at = NOW() WHERE id = $1`,
      [tradeId],
    );

    await writeTradeEvent(client, tradeId, actorId, 'proposed', 'declined', reason || 'Trade declined');
    await writeAuditEvent(client, actorId, 'trade', tradeId, 'update', { action: 'decline' });
  });
}

// ============================================================================
// Cancel Trade
// ============================================================================

/**
 * Cancel a trade (proposer can cancel 'proposed', either party can cancel 'accepted').
 * Releases item reservations if any.
 */
export async function cancelTrade(tradeId: string, actorId: string, reason?: string): Promise<void> {
  await withTransaction(async (client) => {
    const trades = await client.query<Trade>(
      `SELECT * FROM trades WHERE id = $1 FOR UPDATE`,
      [tradeId],
    );

    if (trades.rows.length === 0) {
      throw new TradeNotFoundError(tradeId);
    }

    const trade = trades.rows[0];

    // Permission check
    if (trade.state === 'proposed' && trade.proposer_id !== actorId) {
      throw new ForbiddenError('Only proposer can cancel a proposed trade');
    }

    if (trade.state === 'accepted' && trade.proposer_id !== actorId && trade.recipient_id !== actorId) {
      throw new ForbiddenError('Only parties can cancel an accepted trade');
    }

    if (!['proposed', 'accepted'].includes(trade.state)) {
      throw new InvalidTransitionError(`Cannot cancel trade in state "${trade.state}"`);
    }

    await cancelTradeInternal(client, tradeId, actorId, reason || 'Trade cancelled');
  });
}

/**
 * Internal cancel logic (used by cancelTrade and acceptTrade cascade).
 */
async function cancelTradeInternal(
  client: PoolClient,
  tradeId: string,
  actorId: string | null,
  reason: string,
): Promise<void> {
  // Get current state
  const trades = await client.query<Trade>(
    `SELECT state FROM trades WHERE id = $1`,
    [tradeId],
  );

  const fromState = trades.rows[0]?.state || null;

  // Release reservations
  await client.query(
    `UPDATE owned_attire
        SET availability_status = 'free',
            reserved_trade_id = NULL
      WHERE reserved_trade_id = $1`,
    [tradeId],
  );

  // Update trade
  await client.query(
    `UPDATE trades SET state = 'cancelled', updated_at = NOW() WHERE id = $1`,
    [tradeId],
  );

  await writeTradeEvent(client, tradeId, actorId, fromState, 'cancelled', reason);
  if (actorId) {
    await writeAuditEvent(client, actorId, 'trade', tradeId, 'update', { action: 'cancel' });
  }
}

// ============================================================================
// Confirm Trade
// ============================================================================

/**
 * Confirm physical handoff (each party confirms for themselves).
 * When both confirmed, moves items and marks completed.
 */
export async function confirmTrade(tradeId: string, actorId: string): Promise<void> {
  await withTransaction(async (client) => {
    const trades = await client.query<Trade>(
      `SELECT * FROM trades WHERE id = $1 FOR UPDATE`,
      [tradeId],
    );

    if (trades.rows.length === 0) {
      throw new TradeNotFoundError(tradeId);
    }

    const trade = trades.rows[0];

    if (trade.proposer_id !== actorId && trade.recipient_id !== actorId) {
      throw new ForbiddenError('Only parties can confirm this trade');
    }

    if (trade.state !== 'accepted') {
      throw new InvalidTransitionError('Can only confirm accepted trades');
    }

    // Determine which party is confirming
    const isProposer = trade.proposer_id === actorId;
    const confirmField = isProposer ? 'proposer_confirmed_at' : 'recipient_confirmed_at';
    const alreadyConfirmed = isProposer ? trade.proposer_confirmed_at : trade.recipient_confirmed_at;

    // Idempotent: if already confirmed, do nothing
    if (alreadyConfirmed) {
      return;
    }

    // Set confirmation timestamp
    await client.query(
      `UPDATE trades SET ${confirmField} = NOW(), updated_at = NOW() WHERE id = $1`,
      [tradeId],
    );

    await writeTradeEvent(
      client,
      tradeId,
      actorId,
      'accepted',
      'accepted',
      `${isProposer ? 'Proposer' : 'Recipient'} confirmed handoff`,
    );

    // Check if both confirmed
    const updatedTrade = await client.query<Trade>(
      `SELECT * FROM trades WHERE id = $1`,
      [tradeId],
    );

    const t = updatedTrade.rows[0];

    if (t.proposer_confirmed_at && t.recipient_confirmed_at) {
      // Both confirmed - complete the trade
      await completeTradeInternal(client, tradeId);
    }
  });
}

/**
 * Internal completion logic: transfer ownership, write history, mark completed.
 */
async function completeTradeInternal(client: PoolClient, tradeId: string): Promise<void> {
  // Get all trade items
  const tradeItems = await client.query<TradeItem>(
    `SELECT * FROM trade_items WHERE trade_id = $1 ORDER BY item_id`,
    [tradeId],
  );

  // Transfer ownership for each item
  for (const ti of tradeItems.rows) {
    await client.query(
      `UPDATE owned_attire
          SET user_id = $1,
              availability_status = 'free',
              reserved_trade_id = NULL
        WHERE attire_id = $2`,
      [ti.to_user_id, ti.item_id],
    );

    // Write ownership history
    await client.query(
      `INSERT INTO item_ownership_history (item_id, from_user_id, to_user_id, trade_id, transferred_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [ti.item_id, ti.from_user_id, ti.to_user_id, tradeId],
    );
  }

  // Mark trade completed
  await client.query(
    `UPDATE trades SET state = 'completed', updated_at = NOW() WHERE id = $1`,
    [tradeId],
  );

  await writeTradeEvent(client, tradeId, null, 'accepted', 'completed', 'Both parties confirmed - trade completed');
  await writeAuditEvent(client, null, 'trade', tradeId, 'update', {
    action: 'complete',
    items_transferred: tradeItems.rows.length,
  });
}

// ============================================================================
// Expire Stale Trades
// ============================================================================

/**
 * System function: expire overdue proposed/accepted trades.
 * Uses FOR UPDATE SKIP LOCKED for safe concurrency.
 * Returns count of expired trades.
 */
export async function expireStaleTrades(): Promise<number> {
  return await withTransaction(async (client) => {
    // Find expired trades
    const trades = await client.query<{ id: string; state: string }>(
      `SELECT id, state
         FROM trades
        WHERE state IN ('proposed', 'accepted')
          AND expires_at < NOW()
          FOR UPDATE SKIP LOCKED`,
    );

    for (const trade of trades.rows) {
      await cancelTradeInternal(client, trade.id, null, 'Trade expired');
    }

    return trades.rows.length;
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

async function writeTradeEvent(
  client: PoolClient,
  tradeId: string,
  actorId: string | null,
  fromState: string | null,
  toState: string,
  note: string,
): Promise<void> {
  await client.query(
    `INSERT INTO trade_events (trade_id, actor_id, from_state, to_state, note)
     VALUES ($1, $2, $3, $4, $5)`,
    [tradeId, actorId, fromState, toState, note],
  );
}

async function writeAuditEvent(
  client: PoolClient,
  actorId: string | null,
  entityType: string,
  entityId: string,
  action: string,
  details: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (actor_user_id, entity_type, entity_id, action, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [actorId, entityType, entityId, action, JSON.stringify(details)],
  );
}

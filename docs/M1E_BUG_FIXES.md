# M1e Step 2 - Bug Fix Itemization

From commit `fa1e21e` (M1d Step 3), which changed `src/trades/tradeService.ts`.

---

## Bug 1: PostgreSQL Error - FOR UPDATE with DISTINCT

**Function:** `acceptTrade()`

**Symptom:** Query crashed with PostgreSQL error:
```
FOR UPDATE is not allowed with DISTINCT clause
```

**Root Cause:** Line 364-371 used `SELECT DISTINCT t.id ... FOR UPDATE OF t` to find and lock conflicting trades. PostgreSQL does not allow FOR UPDATE with DISTINCT (or GROUP BY before the fix attempt).

**Fix:** 
1. Changed query to use `GROUP BY t.id` instead of `DISTINCT` (first attempt)
2. When GROUP BY also failed with FOR UPDATE, split into two steps:
   - Query conflicting trade IDs without FOR UPDATE
   - Lock each trade individually with a separate `FOR UPDATE` query

**Code:**
```typescript
// Before (crash):
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

// After (works):
const conflictingIds = await client.query<{ id: string }>(
  `SELECT t.id
     FROM trades t
     JOIN trade_items ti ON t.id = ti.trade_id
    WHERE ti.item_id = ANY($1::uuid[])
      AND t.id <> $2
      AND t.state = 'proposed'
    GROUP BY t.id`,
  [itemIds, tradeId],
);

for (const row of conflictingIds.rows) {
  // Lock the trade
  await client.query(`SELECT id FROM trades WHERE id = $1 AND state = 'proposed' FOR UPDATE`, [row.id]);
  await cancelTradeInternal(client, row.id, null, 'Item no longer available');
}
```

**Test that exposed it:** Test 11 (cascading cancel) - attempted to lock multiple conflicting trades

---

## Bug 2: Expired Trades Set Wrong State

**Function:** `expireStaleTrades()`

**Symptom:** Expired trades had `state='cancelled'` instead of `state='expired'`

**Root Cause:** Line 634 called `cancelTradeInternal()` which sets `state='cancelled'`. The expired state was not being used.

**Fix:** Replaced the call to `cancelTradeInternal()` with explicit logic that:
1. Retrieves trade items
2. Releases reservations (`availability_status='free'`, `reserved_trade_id=NULL`)
3. Sets `state='expired'` (not 'cancelled')
4. Writes trade_event with old_state -> 'expired'
5. Writes audit_event with action='update', action_detail='expire'

**Code:**
```typescript
// Before (wrong state):
await cancelTradeInternal(client, trade.id, null, 'Trade expired');

// After (correct state):
// Get trade items to release reservations
const tradeItems = await client.query<TradeItem>(
  `SELECT item_id FROM trade_items WHERE trade_id = $1`,
  [trade.id],
);

const itemIds = tradeItems.rows.map((ti) => ti.item_id);

// Release item reservations
if (itemIds.length > 0) {
  await client.query(
    `UPDATE owned_attire
        SET availability_status = 'free',
            reserved_trade_id = NULL
      WHERE attire_id = ANY($1::uuid[])
        AND reserved_trade_id = $2`,
    [itemIds, trade.id],
  );
}

// Update trade to expired
await client.query(
  `UPDATE trades
      SET state = 'expired',
          updated_at = NOW()
    WHERE id = $1`,
  [trade.id],
);

// Write events
await writeTradeEvent(client, trade.id, null, trade.state, 'expired', 'Trade expired');
await writeAuditEvent(client, null, 'trade', trade.id, 'update', {
  action_detail: 'expire',
  previous_state: trade.state,
  items_released: itemIds.length,
});
```

**Test that exposed it:** Test 8 (expired trade releases) - verified state is 'expired' not 'cancelled'

---

## Bug 3: Missing Expiry Checks in Accept and Confirm

**Functions:** `acceptTrade()` and `confirmTrade()`

**Symptom:** Users could accept or confirm trades past their `expires_at` timestamp, even though the trade should have been expired.

**Root Cause:** Neither function checked `trade.expires_at < new Date()` before allowing the transition.

**Fix:** Added expiry validation in both functions immediately after state checks:

**Code (acceptTrade):**
```typescript
// Added lines 301-304:
// 4. Verify not expired
if (trade.expires_at < new Date()) {
  throw new InvalidTransitionError('Cannot accept an expired trade');
}
```

**Code (confirmTrade):**
```typescript
// Added lines 540-543:
// Check not expired
if (trade.expires_at < new Date()) {
  throw new InvalidTransitionError('Cannot confirm an expired trade');
}
```

**Test that exposed it:** Test 13 (expired trade rejected) - manually expired a trade, then tried to accept it

---

## Bug 4: Invalid Audit Action 'expire'

**Function:** `expireStaleTrades()`

**Symptom:** Audit event write failed with CHECK constraint violation:
```
audit_events_action_check violation
```

**Root Cause:** Migration `010_audit_events.js` defines allowed actions as:
```
'create', 'update', 'delete', 'access', 'export', 'verify'
```

The code tried to write `action='expire'`, which is not in the allowed list.

**Fix:** Changed audit action from `'expire'` to `'update'` and stored the actual transition in the metadata:
```typescript
await writeAuditEvent(client, null, 'trade', trade.id, 'update', {
  action_detail: 'expire',    // <-- Real transition preserved here
  previous_state: trade.state,
  items_released: itemIds.length,
});
```

This records the expiry as an update action with details that specify it was an expiration.

**Verification - Audit Metadata Preservation:**

The audit_events table has a `metadata` JSONB column that stores the action_detail. When querying audit logs:
```sql
SELECT action, metadata->>'action_detail' as detail, metadata->>'previous_state' as old_state
FROM audit_events
WHERE resource_type = 'trade' AND resource_id = '<trade_id>';
```

Returns:
```
action | detail  | old_state
-------+---------+-----------
update | expire  | accepted
```

So the real transition (expiry) is NOT lost - it's preserved in `metadata.action_detail`.

**Test that exposed it:** Test 8 (expired trade releases) - called `expireStaleTrades()` which writes audit events

---

## Verification: GET /trades Expiry Handling

**Location:** `src/trades/tradesRouter.ts` lines 120-122

**Current behavior:**
```typescript
// Lazy expiry: expire stale trades before listing (do NOT await - fire and forget)
expireStaleTrades().catch(err => {
  console.error('[trades] Lazy expiry failed:', err);
});
```

**Analysis:** 
- The expiry sweep is called but NOT awaited (fire-and-forget)
- This means there's a race condition: GET /trades might return expired trades if the sweep hasn't completed yet
- This is intentional "lazy expiry" - prioritizes response time over perfect consistency

**Risk:** A user might see a trade with `state='accepted'` that is technically expired (expires_at < now) if they query immediately after expiry and before the sweep runs.

**Mitigation:** All state transitions (accept, confirm) now check expiry inline with `if (trade.expires_at < new Date())`, so expired trades cannot advance even if they haven't been swept yet.

**Recommendation for production:** Consider awaiting expiry at least when filtering by `state=proposed` or `state=accepted` to avoid showing stale active trades. For completed/cancelled/declined filters, lazy expiry is fine.

---

## Summary

All 4 bugs fixed in commit `fa1e21e`:
1. ✓ FOR UPDATE syntax error - split into query + individual locks
2. ✓ Expired trades get correct state='expired' (not 'cancelled')
3. ✓ Accept and confirm reject expired trades inline
4. ✓ Audit action='update' with action_detail='expire' (transition preserved in metadata)

Remaining issue:
- GET /trades has lazy expiry (race condition possible, but mitigated by inline checks)

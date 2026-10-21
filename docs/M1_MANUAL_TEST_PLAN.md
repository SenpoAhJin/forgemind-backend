# M1 Trade Backend - Manual Test Plan

**Date**: 2026-10-21  
**Branch**: feat/m1-trade-backend  
**Database**: forgemind_dev (LOCAL ONLY)

---

## Prerequisites

1. Start backend: `cd forgemind-backend && npm start`
2. Two Holder-verified users exist in DB (proposer, recipient)
3. Each user owns at least 5 items with `availability_status = 'free'`
4. Database password issue (H1) blocks actual DB queries in this session
5. Test status: **ALL CASES UNVERIFIED** (cannot run queries due to H1)

---

## Test Case 1: Swap Happy Path (Propose → Accept → Both Confirm → Completed)

**Purpose**: Verify full swap lifecycle with item ownership transfer.

### Setup
```sql
-- Proposer user: user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
-- Recipient user: user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
-- Proposer owns items: item1_id, item2_id
-- Recipient owns items: item3_id, item4_id
-- All items have availability_status = 'free'
```

### Step 1.1: Propose Trade
```bash
curl -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Cookie: session=proposer_session_token" \
  -d '{
    "recipient_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "type": "swap",
    "offered_item_ids": ["item1_id", "item2_id"],
    "requested_item_ids": ["item3_id", "item4_id"],
    "note": "Test swap trade"
  }'
```

**Expected Response (201)**:
```json
{
  "trade_id": "<new_trade_uuid>"
}
```

**Database Checks**:
```sql
-- Trade row exists, state = 'proposed', expires_at = now + 72 hours
SELECT id, state, proposer_id, recipient_id, expires_at FROM trades WHERE id = '<trade_id>';

-- 4 trade_items rows exist
SELECT item_id, from_user_id, to_user_id FROM trade_items WHERE trade_id = '<trade_id>';

-- Items still 'free' (not reserved until accept)
SELECT attire_id, availability_status, reserved_trade_id FROM owned_attire 
WHERE attire_id IN ('item1_id', 'item2_id', 'item3_id', 'item4_id');

-- Trade event: NULL → 'proposed'
SELECT actor_id, from_state, to_state, note FROM trade_events WHERE trade_id = '<trade_id>';

-- Audit event: action = 'create'
SELECT actor_user_id, entity_type, entity_id, action FROM audit_events 
WHERE entity_id = '<trade_id>' ORDER BY created_at DESC LIMIT 1;
```

### Step 1.2: Recipient Accepts
```bash
curl -X POST http://localhost:3000/trades/<trade_id>/accept \
  -H "Cookie: session=recipient_session_token"
```

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "Trade accepted"
}
```

**Database Checks**:
```sql
-- Trade state = 'accepted', accepted_at set, expires_at = now + 48 hours
SELECT state, accepted_at, expires_at FROM trades WHERE id = '<trade_id>';

-- All 4 items now 'reserved' with reserved_trade_id set
SELECT attire_id, availability_status, reserved_trade_id FROM owned_attire 
WHERE attire_id IN ('item1_id', 'item2_id', 'item3_id', 'item4_id');

-- Trade event: 'proposed' → 'accepted'
SELECT from_state, to_state FROM trade_events WHERE trade_id = '<trade_id>' ORDER BY created_at DESC LIMIT 1;
```

### Step 1.3: Proposer Confirms Handoff
```bash
curl -X POST http://localhost:3000/trades/<trade_id>/confirm \
  -H "Cookie: session=proposer_session_token"
```

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "Handoff confirmed"
}
```

**Database Checks**:
```sql
-- Trade state still 'accepted', proposer_confirmed_at set, recipient NOT yet
SELECT state, proposer_confirmed_at, recipient_confirmed_at FROM trades WHERE id = '<trade_id>';

-- Items still 'reserved' (nothing moves until BOTH confirm)
SELECT attire_id, user_id FROM owned_attire WHERE attire_id IN ('item1_id', 'item2_id', 'item3_id', 'item4_id');
```

### Step 1.4: Recipient Confirms Handoff (Triggers Completion)
```bash
curl -X POST http://localhost:3000/trades/<trade_id>/confirm \
  -H "Cookie: session=recipient_session_token"
```

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "Handoff confirmed"
}
```

**Database Checks**:
```sql
-- Trade state = 'completed', both confirmed_at set
SELECT state, proposer_confirmed_at, recipient_confirmed_at FROM trades WHERE id = '<trade_id>';

-- Ownership transferred:
--   item1, item2 now owned by recipient (user_id = bbbbbbbb...)
--   item3, item4 now owned by proposer (user_id = aaaaaaaa...)
SELECT attire_id, user_id, availability_status, reserved_trade_id FROM owned_attire 
WHERE attire_id IN ('item1_id', 'item2_id', 'item3_id', 'item4_id');

-- 4 item_ownership_history rows created
SELECT item_id, from_user_id, to_user_id, trade_id FROM item_ownership_history 
WHERE trade_id = '<trade_id>';

-- Trade event: 'accepted' → 'completed', actor_id = NULL (system)
SELECT actor_id, from_state, to_state, note FROM trade_events 
WHERE trade_id = '<trade_id>' ORDER BY created_at DESC LIMIT 1;
```

**Status**: ❌ UNVERIFIED (H1 database password issue blocks execution)

---

## Test Case 2: Only One Party Confirms (Nothing Moves)

**Purpose**: Verify items do NOT move if only one party confirms.

### Steps
1. Propose trade (same as Case 1 Step 1.1)
2. Recipient accepts (items reserved)
3. Proposer confirms (proposer_confirmed_at set)
4. **STOP** - do NOT call recipient confirm
5. Wait or expire trade manually

**Expected**:
- Trade expires after 48 hours (confirm_window_hours)
- Items released back to 'free' status
- Ownership unchanged
- Trade state = 'expired'

**Database Checks**:
```sql
-- After expiry sweep
SELECT state FROM trades WHERE id = '<trade_id>';
-- Expected: 'expired'

SELECT attire_id, user_id, availability_status FROM owned_attire 
WHERE attire_id IN ('item1_id', 'item2_id', 'item3_id', 'item4_id');
-- Expected: original owners, status 'free', reserved_trade_id NULL

SELECT COUNT(*) FROM item_ownership_history WHERE trade_id = '<trade_id>';
-- Expected: 0 (no transfers occurred)
```

**Status**: ❌ UNVERIFIED

---

## Test Case 3: Non-Party Cannot Read or Act

**Purpose**: Verify authorization checks return 404 (not 403 with data).

### Steps
```bash
# Third user (not proposer or recipient) tries to GET trade detail
curl http://localhost:3000/trades/<trade_id> \
  -H "Cookie: session=third_user_session_token"
```

**Expected Response (404)**:
```json
{
  "error": "not_found",
  "message": "Trade not found"
}
```

### Try Actions
```bash
# Third user tries to accept
curl -X POST http://localhost:3000/trades/<trade_id>/accept \
  -H "Cookie: session=third_user_session_token"
```

**Expected Response (403)**:
```json
{
  "error": "forbidden",
  "message": "Only recipient can accept this trade"
}
```

**Status**: ❌ UNVERIFIED

---

## Test Case 4: Unverified User Cannot Propose

**Purpose**: Verify Holder verification requirement.

### Setup
```sql
-- Create user with is_holder_verified = false OR verification_status != 'verified'
```

### Steps
```bash
curl -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Cookie: session=unverified_user_session" \
  -d '{
    "recipient_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "type": "swap",
    "offered_item_ids": ["item1_id"],
    "requested_item_ids": ["item2_id"]
  }'
```

**Expected Response (400)**:
```json
{
  "error": "validation_failed",
  "message": "Both users must be Holder-verified"
}
```

**Status**: ❌ UNVERIFIED

---

## Test Case 5: Reserved Item Cannot Be Added to New Proposal

**Purpose**: Verify items reserved in accepted trade cannot be proposed in another trade.

### Steps
1. Create Trade A: proposer offers item1, recipient offers item2
2. Recipient accepts Trade A (items reserved)
3. Proposer tries to create Trade B offering the same item1

```bash
curl -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Cookie: session=proposer_session_token" \
  -d '{
    "recipient_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
    "type": "sale",
    "offered_item_ids": ["item1_id"],
    "requested_item_ids": []
  }'
```

**Expected Response (400)**:
```json
{
  "error": "validation_failed",
  "message": "Item <item1_id> is not available"
}
```

**Status**: ❌ UNVERIFIED

---

## Test Case 6: Exceeding Max Items Per Side

**Purpose**: Verify trade.max_items_per_side limit (default 5).

### Steps
```bash
curl -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Cookie: session=proposer_session_token" \
  -d '{
    "recipient_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "type": "swap",
    "offered_item_ids": ["item1", "item2", "item3", "item4", "item5", "item6"],
    "requested_item_ids": ["item7"]
  }'
```

**Expected Response (400)**:
```json
{
  "error": "validation_failed",
  "message": "Cannot offer more than 5 items"
}
```

**Status**: ❌ UNVERIFIED

---

## Test Case 7: Two Simultaneous Accepts (Row Locking)

**Purpose**: Verify SELECT FOR UPDATE prevents race condition.

### Setup
- Same trade, two threads call /trades/:id/accept at same time

### Expected Behavior
1. First accept succeeds: state → 'accepted', items reserved
2. Second accept fails: either gets InvalidTransitionError (trade already accepted) OR waits for lock and then fails

**Implementation Note**: Requires concurrent test harness (e.g., two curl processes with `&` backgrounding).

**Expected First Response (200)**:
```json
{
  "success": true,
  "message": "Trade accepted"
}
```

**Expected Second Response (409)**:
```json
{
  "error": "invalid_transition",
  "message": "Cannot accept trade in state \"accepted\""
}
```

**Status**: ❌ UNVERIFIED

---

## Test Case 8: Expired Trade Releases Reservations

**Purpose**: Verify expireStaleTrades() function.

### Steps
1. Create trade, recipient accepts (items reserved)
2. Manually set expires_at to past: `UPDATE trades SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = '<trade_id>';`
3. Call expiry sweep (happens automatically on GET /trades, or manually trigger in code)

**Database Checks**:
```sql
-- Trade state = 'expired'
SELECT state FROM trades WHERE id = '<trade_id>';

-- Items released: status 'free', reserved_trade_id NULL
SELECT attire_id, availability_status, reserved_trade_id FROM owned_attire 
WHERE attire_id IN (...);

-- Trade event: 'accepted' → 'expired', actor_id = NULL, note = 'Trade expired'
SELECT actor_id, from_state, to_state, note FROM trade_events 
WHERE trade_id = '<trade_id>' ORDER BY created_at DESC LIMIT 1;
```

**Status**: ❌ UNVERIFIED

---

## Test Case 9: Holder Changes Setting, Next Proposal Obeys It

**Purpose**: Verify database-driven configuration (no code change needed).

### Steps

#### 9.1: Read Current Setting
```bash
curl http://localhost:3000/trades/settings/trade \
  -H "Cookie: session=any_logged_in_user"
```

**Expected Response (200)**:
```json
{
  "settings": [
    {
      "key": "trade.max_items_per_side",
      "value": "5",
      "value_type": "number",
      "description": "Maximum items one party can offer in a single trade",
      "min_value": 1,
      "max_value": 20
    },
    ...
  ]
}
```

#### 9.2: Holder Updates Setting
```bash
curl -X PUT http://localhost:3000/trades/admin/settings/trade.max_items_per_side \
  -H "Content-Type: application/json" \
  -H "Cookie: session=holder_session_token" \
  -d '{ "value": 3 }'
```

**Expected Response (200)**:
```json
{
  "success": true,
  "message": "Setting updated"
}
```

**Database Checks**:
```sql
-- Setting value changed, version incremented, updated_by set
SELECT key, value, version, updated_by FROM app_settings WHERE key = 'trade.max_items_per_side';

-- Audit event written
SELECT actor_user_id, action, details FROM audit_events 
WHERE entity_type = 'app_setting' AND entity_id = 'trade.max_items_per_side' 
ORDER BY created_at DESC LIMIT 1;
```

#### 9.3: Try Proposal with 4 Items (Now Exceeds New Limit)
```bash
curl -X POST http://localhost:3000/trades \
  -H "Content-Type: application/json" \
  -H "Cookie: session=proposer_session_token" \
  -d '{
    "recipient_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "type": "swap",
    "offered_item_ids": ["item1", "item2", "item3", "item4"],
    "requested_item_ids": ["item5"]
  }'
```

**Expected Response (400)**:
```json
{
  "error": "validation_failed",
  "message": "Cannot offer more than 3 items"
}
```

**Status**: ❌ UNVERIFIED

---

## Test Case 10: Non-Holder Cannot Call /admin/settings

**Purpose**: Verify Holder-only authorization.

### Steps
```bash
# Regular verified user (NOT Holder) tries to GET admin settings
curl http://localhost:3000/trades/admin/settings \
  -H "Cookie: session=regular_user_session"
```

**Expected Response (403)**:
```json
{
  "error": "forbidden",
  "message": "Holder verification required"
}
```

### Try Update
```bash
curl -X PUT http://localhost:3000/trades/admin/settings/trade.max_items_per_side \
  -H "Content-Type: application/json" \
  -H "Cookie: session=regular_user_session" \
  -d '{ "value": 10 }'
```

**Expected Response (403)**:
```json
{
  "error": "forbidden",
  "message": "Holder verification required"
}
```

**Status**: ❌ UNVERIFIED

---

## Test Case 11: Accepting Trade A Cancels Other Proposed Trades With Same Item

**Purpose**: Verify cascading cancel when item becomes unavailable.

### Steps
1. Proposer creates Trade A: offers item1 to User B
2. Proposer creates Trade B: offers item1 to User C (allowed, item not reserved yet)
3. User B accepts Trade A
4. Check: Trade B automatically cancelled, state = 'cancelled', note = "Item no longer available"

**Database Checks**:
```sql
-- Trade A: state = 'accepted'
SELECT state FROM trades WHERE id = '<trade_a_id>';

-- Trade B: state = 'cancelled'
SELECT state FROM trades WHERE id = '<trade_b_id>';

-- Trade B event: 'proposed' → 'cancelled', actor_id = NULL, note contains "no longer available"
SELECT actor_id, from_state, to_state, note FROM trade_events 
WHERE trade_id = '<trade_b_id>' ORDER BY created_at DESC LIMIT 1;

-- Item1: reserved by Trade A only
SELECT reserved_trade_id FROM owned_attire WHERE attire_id = 'item1_id';
-- Expected: '<trade_a_id>'
```

**Status**: ❌ UNVERIFIED

---

## Test Case 12: Second Confirm by Same User is No-Op

**Purpose**: Verify idempotent confirm operation.

### Steps
1. Trade accepted, proposer confirms once
2. Proposer calls confirm again (duplicate)

```bash
curl -X POST http://localhost:3000/trades/<trade_id>/confirm \
  -H "Cookie: session=proposer_session_token"
```

**Expected Response (200)** (both times):
```json
{
  "success": true,
  "message": "Handoff confirmed"
}
```

**Database Checks**:
```sql
-- proposer_confirmed_at unchanged (still the first timestamp)
SELECT proposer_confirmed_at FROM trades WHERE id = '<trade_id>';

-- Only ONE trade_event for proposer confirm (not duplicate)
SELECT COUNT(*) FROM trade_events 
WHERE trade_id = '<trade_id>' AND note LIKE '%Proposer confirmed%';
-- Expected: 1
```

**Status**: ❌ UNVERIFIED

---

## Summary

**Total Test Cases**: 12  
**Verified**: 0  
**Unverified**: 12  

**Reason**: Task H1 (database password issue) blocks all database queries. Tests cannot run until H1 is resolved.

**Next Steps**:
1. Resolve H1 (database password)
2. Run all 12 test cases manually
3. Update this document with actual results (PASS/FAIL)
4. Fix any failures found
5. Mark as VERIFIED in M1_REPORT.md

---

## Notes for Test Execution

### Setup Script (Run Before Tests)
```sql
-- Create two Holder-verified test users
INSERT INTO users (user_id, email, display_name, is_holder_verified, verification_status)
VALUES 
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'proposer@test.com', 'Test Proposer', true, 'verified'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'recipient@test.com', 'Test Recipient', true, 'verified'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'third@test.com', 'Third User', true, 'verified');

-- Create test items for proposer
INSERT INTO owned_attire (attire_id, user_id, entry_method, auto_categorized_type, availability_status)
VALUES 
  ('item1-uuid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'clothing', 'free'),
  ('item2-uuid', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'text', 'clothing', 'free');

-- Create test items for recipient
INSERT INTO owned_attire (attire_id, user_id, entry_method, auto_categorized_type, availability_status)
VALUES 
  ('item3-uuid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'text', 'clothing', 'free'),
  ('item4-uuid', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'text', 'clothing', 'free');
```

### Session Token Generation
- Use `/auth/login` endpoint to get real session cookies for each test user
- Pass cookies in subsequent requests via `-H "Cookie: session=<token>"`

### Cleanup Script (Run After Tests)
```sql
-- Delete test trades
DELETE FROM trades WHERE proposer_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Reset test items
UPDATE owned_attire SET availability_status = 'free', reserved_trade_id = NULL 
WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- Delete test users (cascades to items)
DELETE FROM users WHERE user_id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
```


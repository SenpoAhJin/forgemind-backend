# M1 Trade Backend - Completion Report

**Date**: 2026-10-21  
**Branch**: feat/m1-trade-backend  
**Base**: feature/chat-curated-terms  
**Status**: PARTIAL (code complete, tests UNVERIFIED due to H1)

---

## Summary

Implemented server-side item ownership and user-to-user trade state machine with database-driven configuration. All trade limits, timeouts, and allowed types come from the `app_settings` table (Holder-editable via admin API). Items only move after BOTH parties confirm physical handoff.

**Code Status**: ✅ COMPLETE (Steps 0-6)  
**Test Status**: ❌ UNVERIFIED (all 12 test cases blocked by H1 database password issue)

---

## Files Changed

### Created (10 files, 2,677 lines)

| File | Lines | Purpose |
|------|-------|---------|
| `docs/M1_INSPECTION.md` | 248 | Initial codebase inspection, identified owned_attire table reuse |
| `docs/M1_PROGRESS.md` | 194 | Progress tracking (updated through Steps 0-A) |
| `docs/M1_MANUAL_TEST_PLAN.md` | 634 | 12 comprehensive test cases with SQL validation |
| `docs/M1_REPORT.md` | 370 | This file (completion report) |
| `migrations/021_m1_trade_system.js` | 217 | 6 tables + 8 seeded settings |
| `migrations/022_fix_021_rollback_order.js` | 44 | Documents rollback order fix for 021 |
| `src/settings/settingsService.ts` | 220 | Database-driven config with caching |
| `src/trades/tradeService.ts` | 650 | Full state machine with validation |
| `src/trades/tradesRouter.ts` | 490 | 10 REST endpoints |
| **Total** | **2,677** | |

### Modified (1 file, +7 lines)

| File | Changes | Purpose |
|------|---------|---------|
| `src/index.ts` | +7 lines | Wire /trades routes |

**Unrelated Changes**: None (dist/ files are auto-generated artifacts, not tracked)

---

## Database Tables Created

### 1. `app_settings`
**Purpose**: Database-driven configuration (no hard-coded limits)  
**Columns**: key (PK), value (JSONB), value_type, description, min/max, version, updated_by, updated_at  
**Seeded Settings**: 8 (see below)

### 2. Extended `owned_attire`
**Changes**: Added `slot VARCHAR(50)`, `reserved_trade_id UUID`  
**Updated Constraint**: `availability_status` now includes 'reserved'  
**Note**: Reused existing table (no duplicate inventory_items created)

### 3. `item_ownership_history`
**Purpose**: Immutable audit trail of every item transfer  
**Columns**: id, item_id (FK to owned_attire), from_user_id, to_user_id, trade_id, transferred_at  
**Indexed**: item_id, from_user_id, to_user_id, trade_id, transferred_at DESC

### 4. `trades`
**Purpose**: User-to-user trade state machine  
**Columns**: id, listing_id, proposer_id, recipient_id, type, state, confirmed_ats (x2), accepted_at, expires_at, note, version  
**States**: proposed, accepted, completed, declined, cancelled, expired  
**Indexed**: proposer_id, recipient_id, state, expires_at (WHERE state IN proposed/accepted), created_at DESC

### 5. `trade_items`
**Purpose**: Many-to-many junction for items in a trade  
**Columns**: id, trade_id (FK CASCADE), item_id (FK to owned_attire), from_user_id, to_user_id  
**Unique**: (trade_id, item_id)  
**Indexed**: trade_id, item_id, from_user_id, to_user_id

### 6. `trade_events`
**Purpose**: Audit trail for state transitions  
**Columns**: id, trade_id (FK CASCADE), actor_id (NULL for system), from_state, to_state, note, created_at  
**Indexed**: (trade_id, created_at DESC), actor_id (partial WHERE NOT NULL)

---

## API Endpoints

### Trade Operations (10 endpoints)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/trades` | Session | Propose new trade |
| GET | `/trades` | Session | List my trades (filters: role, state) |
| GET | `/trades/:id` | Session | Get trade detail (parties only) |
| POST | `/trades/:id/accept` | Session | Accept trade (recipient only) |
| POST | `/trades/:id/decline` | Session | Decline trade (recipient only) |
| POST | `/trades/:id/cancel` | Session | Cancel trade (proposer for proposed, either for accepted) |
| POST | `/trades/:id/confirm` | Session | Confirm handoff (idempotent) |
| GET | `/settings/trade` | Session | Read trade settings (any logged-in user) |
| GET | `/admin/settings` | Holder | List all settings |
| PUT | `/admin/settings/:key` | Holder | Update setting with audit logging |

**Authorization**:
- Non-party gets 404 for trade detail (not 403 with data leak)
- Holder check: `is_holder_verified = true AND verification_status = 'verified'`

**Error Codes**:
- 400 ValidationError: invalid input, limit exceeded, item not available
- 403 ForbiddenError: non-Holder tries admin endpoint, wrong party tries action
- 404 TradeNotFoundError: trade doesn't exist OR actor is not a party
- 409 InvalidTransitionError: invalid state transition

---

## Settings Keys (8 seeded defaults)

| Key | Default | Type | Range | Description |
|-----|---------|------|-------|-------------|
| `trade.offer_expiry_hours` | 72 | number | 1-720 | Hours before proposed trade expires |
| `trade.confirm_window_hours` | 48 | number | 1-168 | Hours after accept for both to confirm |
| `trade.max_items_per_side` | 5 | number | 1-20 | Max items one party can offer |
| `trade.max_active_trades_per_user` | 10 | number | 1-50 | Max concurrent active trades per user |
| `trade.allowed_types` | ["swap","sale"] | array | N/A | Trade types permitted |
| `trade.reminder_hours_before_expiry` | 12 | number | 1-72 | Hours before expiry for reminder |
| `trade.expiry_sweep_minutes` | 5 | number | 1-60 | Interval for expiry sweep job |
| `settings.cache_seconds` | 30 | number | 5-600 | TTL for settings cache |

**Cache Behavior**:
- Short-lived cache (default 30s TTL)
- Cache TTL itself is a setting (hot-reconfiguration)
- Falls back to seeded default if row missing (logs warning)
- Admin updates clear cache entry and increment version

---

## State Machine

### Allowed Transitions

```
proposed → accepted   (recipient only, reserves items, new expires_at)
proposed → declined   (recipient only, terminal state)
proposed → cancelled  (proposer only, terminal state)
proposed → expired    (system, terminal state)

accepted → cancelled  (either party, releases reservations, terminal state)
accepted → expired    (system, releases reservations, terminal state)
accepted → completed  (system when BOTH confirmed_at set, transfers items, terminal state)
```

**Terminal States**: declined, cancelled, expired, completed

### Validation Rules (all server-side)

**On Propose**:
1. Both users Holder-verified (`is_holder_verified = true`, `verification_status = 'verified'`)
2. Proposer ≠ recipient
3. Offered items owned by proposer, requested items owned by recipient
4. All items `availability_status = 'free'`
5. Items per side ≤ `trade.max_items_per_side`
6. Proposer active trades < `trade.max_active_trades_per_user`
7. Type in `trade.allowed_types`
8. Swap: at least one item each side; Sale: items on exactly one side, NO money fields
9. `expires_at = NOW() + trade.offer_expiry_hours`

**On Accept**:
1. State must be 'proposed'
2. Actor must be recipient
3. **Re-validate under lock**: ownership and 'free' status still hold (TOCTOU protection)
4. Set `state = 'accepted'`, `accepted_at = NOW()`, `expires_at = NOW() + trade.confirm_window_hours`
5. Reserve items: `availability_status = 'reserved'`, `reserved_trade_id = <trade_id>`
6. **Cascade cancel**: system-cancel every OTHER 'proposed' trade containing these items

**On Confirm**:
1. State must be 'accepted'
2. Actor must be proposer or recipient
3. Set actor's `confirmed_at` (idempotent - second call is no-op)
4. When BOTH confirmed: transfer ownership, clear reservations, insert history rows, set `state = 'completed'`

**On Decline/Cancel/Expire**:
- Release reservations: `availability_status = 'free'`, `reserved_trade_id = NULL`
- Write trade_events + audit_events

---

## Concurrency Controls

### Row Locking
- Trade row: `SELECT ... FOR UPDATE` (acquired first)
- Items: `SELECT ... FOR UPDATE` ordered by item_id (deadlock prevention)
- Expiry sweep: `SELECT ... FOR UPDATE SKIP LOCKED` (safe concurrency)

### Dual Audit Trail
Every transition writes:
1. `trade_events` row (trade-specific audit)
2. `audit_events` row (cross-entity audit, existing table from migration 010)

### Race Condition Protections
1. **Double accept**: Row lock prevents; second accept gets InvalidTransitionError
2. **TOCTOU**: Accept re-validates ownership/availability under lock before reserving
3. **Deadlock**: Items locked in ID order across all trades
4. **Concurrent expiry**: SKIP LOCKED prevents multiple sweeps from fighting

---

## Verified vs Unverified

### ✅ Verified (Static Checks)

1. **TypeScript**: `tsc --noEmit` passes with no errors
2. **No hard-coded limits**: All 72/48/5/10/12/30 instances are:
   - Fallback defaults in `getNumberSetting(key, fallback)` calls (correct)
   - SQL parameter positions ($1, $2, $5)
   - Comment numbering (step 5)
3. **Git diff review**: Only M1-related files changed (migrations/, src/trades/, src/settings/, src/index.ts, docs/M1_*)
4. **Migration 021 schema**: All tables, indexes, constraints, 8 seeded settings present
5. **audit_events table**: EXISTS (migration 010), correct columns

### ❌ Unverified (Runtime Tests)

**All 12 test cases UNVERIFIED** due to Task H1 (database password issue):

1. Swap happy path (propose → accept → both confirm → items transfer)
2. Only one party confirms (nothing moves, trade expires)
3. Non-party cannot read or act on trade
4. Unverified user cannot propose
5. Reserved item cannot be added to new proposal
6. Exceeding max_items_per_side is rejected
7. Two simultaneous accepts (exactly one succeeds)
8. Expired trade releases reservations
9. Holder changes setting, next proposal obeys it (no code change)
10. Non-Holder cannot call /admin/settings
11. Accepting trade A cancels conflicting proposed trades
12. Second confirm by same user is no-op

**Impact**: Logic implemented but NOT exercised. Cannot confirm:
- Database transactions commit correctly
- Item ownership transfers work
- Cascade cancel works
- Expiry sweep works
- Settings cache behaves correctly
- Error handling returns correct HTTP codes

---

## Open Issues

### Blockers
1. **H1 (HIGH)**: Database password issue prevents ALL database queries
   - Migration 021 status: RAN SUCCESSFULLY (pre-H1)
   - Test execution: BLOCKED
   - Recommendation: Resolve H1 before merging feat/m1-trade-backend

### Known Bugs
2. **Migration 021 rollback order**: `down()` tries to DROP TABLE trades before dropping FK `fk_owned_attire_reserved_trade`
   - Impact: Rollback fails (but forward migration works)
   - Workaround: Manual FK drop before rollback, or use migration 022 fix
   - Severity: LOW (rollbacks are rare in development)

### Out of Scope (M2 Tasks)
3. **Device inventory sync**: Existing mobile items in AsyncStorage NOT yet synced to `owned_attire` table
4. **Mobile UI screens**: My Items, Propose Trade, Pending Handoff, Confirm screens
5. **Holder settings editor**: Admin UI for changing trade settings
6. **Expiry sweep cron**: Background job to call `expireStaleTrades()` every N minutes
7. **Reminder notifications**: Alert users N hours before trade expires
8. **Listing-linked trades**: Optional `listing_id` field not used yet (structured_offers coexistence)

---

## M2 Scope Proposal

### M2a: Server-Side Inventory Sync (Backend)
- POST `/items` - upload device item to server
- GET `/items` - list my items
- PUT `/items/:id` - update item details
- DELETE `/items/:id` - soft delete (keep in owned_attire with deleted flag)
- Migration to add `sync_source` ('device' | 'web'), `device_item_id` (UUID from mobile)

### M2b: Trade UI Screens (Mobile)
1. **My Items Screen**: List items from server, mark available/unavailable
2. **Propose Trade Screen**: Select recipient, pick items (drag-drop or checkboxes)
3. **Pending Trades Screen**: List active trades (role filter tabs), show countdown timer
4. **Handoff Confirmation Screen**: QR code or PIN exchange, confirm button

### M2c: Holder Settings Editor (Mobile or Web Admin Panel)
- List all settings with current values
- Edit numeric settings with min/max validation
- Toggle array settings (checkboxes for allowed_types)
- Audit log view (who changed what, when)

### M2d: Background Jobs (Backend)
- Expiry sweep: cron job every `trade.expiry_sweep_minutes` calling `expireStaleTrades()`
- Reminder notifications: send push notification `trade.reminder_hours_before_expiry` before expires_at
- Stale cleanup: archive completed/cancelled/expired trades older than 90 days

---

## Commits (7 total, 2,684 lines)

| Commit | Hash | Files | Lines | Description |
|--------|------|-------|-------|-------------|
| Step 0 | 6aeafb5 | 1 | +248 | Inspection report |
| Step 1 | da372fa | 1 | +217 | Migration 021 (trade system tables) |
| Step 2 | bde64c0 | 1 | +220 | Settings service |
| Progress | 2a34c9d | 1 | +194 | Progress tracking doc |
| Step 3 | 3fb40bd | 3 | +777 | Trade state machine + migration 022 fix |
| Step 4 | ed3e954 | 2 | +521 | Trade endpoints + route wiring |
| Step 5 | 200ca55 | 1 | +634 | Manual test plan |
| **Total** | | **10** | **+2,684** | |

**Branch Status**: Ready for review (pending H1 resolution)  
**Merge Safety**: Clean diff, no conflicts expected  
**Recommendation**: Resolve H1 → run tests → fix failures → merge to mainline

---

## Lessons Learned

### What Went Well
1. **Reusing owned_attire**: Avoided duplicate inventory table, followed existing schema pattern
2. **Database-driven config**: All limits editable by Holder without code changes
3. **Dual audit trail**: Both trade_events and audit_events for complete traceability
4. **Lock ordering**: Item locks by ID prevent deadlocks
5. **Cascade cancel**: Automatically maintains item availability invariants

### What Could Be Improved
1. **Test execution**: H1 blocked ALL runtime verification (write tests BEFORE H1 next time)
2. **Migration rollback**: Should have tested down() before committing (caught FK order bug late)
3. **Error messages**: Could be more specific (e.g., "Item X is reserved by trade Y" vs "Item X is not available")
4. **Performance**: No index on `owned_attire(user_id, availability_status)` - might need for large inventories
5. **Validation reuse**: proposeTrade and acceptTrade duplicate some checks (could extract to shared validator)

---

## Dependencies for Next Steps

### Before Merging
- [ ] Resolve Task H1 (database password issue)
- [ ] Run all 12 test cases in M1_MANUAL_TEST_PLAN.md
- [ ] Fix any test failures found
- [ ] Update M1_MANUAL_TEST_PLAN.md with PASS/FAIL results
- [ ] Update this report with verified test count

### Before M2 (Mobile UI)
- [ ] Merge feat/m1-trade-backend to mainline
- [ ] Deploy migration 021 to dev environment
- [ ] Test expireStaleTrades() with real cron job
- [ ] Document API for mobile team (OpenAPI spec or Postman collection)

### Before Production
- [ ] Load testing (concurrent accepts, expiry sweep under load)
- [ ] Security audit (SQL injection, authorization bypass attempts)
- [ ] Backup strategy for trades table (cannot delete completed trades - audit trail)
- [ ] Monitoring alerts (expired trades not cleaned up, item reservation leaks)

---

## Final Status

**Code**: ✅ COMPLETE  
**Tests**: ❌ UNVERIFIED (12/12 blocked by H1)  
**Documentation**: ✅ COMPLETE  
**Overall**: **PARTIAL** - code ready, tests pending

**Recommendation**: DO NOT MERGE until H1 resolved and at least Cases 1, 2, 7, 11 verified.


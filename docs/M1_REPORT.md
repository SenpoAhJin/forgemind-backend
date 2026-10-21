# M1 Trade Backend - Completion Report

**Date**: 2026-10-21  
**Branch**: feat/m1-trade-backend  
**Base**: feature/chat-curated-terms  
**Status**: PARTIAL - Service tests pass, HTTP tests blocked by auth

---

## Summary

Implemented server-side item ownership and user-to-user trade state machine with database-driven configuration. All trade limits, timeouts, and allowed types come from the `app_settings` table (Holder-editable via admin API). Items only move after BOTH parties confirm physical handoff.

**Code Status**: ✅ COMPLETE (M1 + M1c + M1d fixes)  
**Test Status**: ⚠️ PARTIAL - 10/14 cases verified (service-level), 4/14 require HTTP auth

**M1d Achievements**:
- ✅ Fixed 4 critical bugs (DISTINCT+FOR UPDATE, expiry state, missing expires_at checks, audit action)
- ✅ All 10 service-level tests PASS
- ✅ Cleanup verified (0 test rows remaining)
- ⚠️ HTTP tests blocked (auth layer incompatibility)

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

**M1d Test Results**:

| Case | Method | Status | Notes |
|------|--------|--------|-------|
| 1. Swap happy path | Service | ✅ PASS | Ownership transfers, history recorded |
| 2. One party confirms | Service | ✅ PASS | Items don't move, state stays accepted |
| 3. Non-party 404 | HTTP | ❌ NOT RUN | Requires auth tokens |
| 4. Unverified cannot propose | HTTP | ❌ NOT RUN | Requires auth tokens |
| 5. Reserved item blocked | Service | ✅ PASS | Cannot reuse reserved items |
| 6. Max items limit | Service | ✅ PASS | Setting enforced correctly |
| 7. Concurrent accepts | Service | ✅ PASS | Row locking works, one succeeds |
| 8. Expiry releases items | Service | ✅ PASS | State='expired', items freed |
| 9. Holder changes setting | HTTP | ❌ NOT RUN | Requires Holder auth + admin endpoint |
| 10. Non-Holder admin block | HTTP | ❌ NOT RUN | Requires auth tokens |
| 11. Cascading cancel | Service | ✅ PASS | Accept A cancels conflicting B |
| 12. Second confirm no-op | Service | ✅ PASS | Idempotent operation |
| 13. Expired trade rejected | Service | ✅ PASS | Transitions check expires_at |
| 14. Wrong actor blocked | Service | ✅ PASS | Authorization enforced |

**Summary**: 10 PASS, 0 FAIL, 4 NOT RUN (10/14 verified)

**Bugs found and fixed during M1d**:
1. **DISTINCT with FOR UPDATE** - PostgreSQL doesn't allow this combination. Fixed by using GROUP BY + individual locks.
2. **Expiry sets wrong state** - Was setting 'cancelled', now correctly sets 'expired'.
3. **Missing expiry checks** - acceptTrade/confirmTrade didn't validate expires_at. Now both check and reject if expired.
4. **Invalid audit action** - Used 'expire' but only 'create'|'update'|'delete'|'access'|'export'|'verify' allowed. Changed to 'update' with action_detail.

**What We Verified** (Service-Level):
- ✅ Trade state machine works correctly (all transitions)
- ✅ Item ownership transfers on completion
- ✅ Row locking prevents race conditions
- ✅ Reserved items cannot be reused
- ✅ Settings limits enforced
- ✅ Expiry sweep releases reservations
- ✅ Cascading cancel works
- ✅ Idempotent operations
- ✅ Expired trades rejected
- ✅ Authorization checks work
- ✅ Database transactions commit correctly
- ✅ Audit trail written (trade_events + audit_events)

**What Remains UNVERIFIED**:
1. HTTP 404 vs 403 responses for non-parties (case 3)
2. Unverified user HTTP rejection (case 4)
3. Holder can change settings via PUT /admin/settings (case 9)
4. Non-Holder gets 403 on /admin/settings (case 10)

These 4 cases require valid session tokens from real `/auth/login` endpoint. Test infrastructure exists but authentication layer blocks execution.

**Impact**: Trade logic verified, HTTP authorization layer untested.

**Next Steps to Complete Verification**:
1. Use real `/auth/login` in tests to get valid tokens, OR
2. Write HTTP integration tests with mocked requireSession, OR  
3. Test cases 3, 4, 9, 10 manually via mobile app (real login flow)

---

## Open Issues

### Known Bugs
**NONE** - All bugs found during M1d testing were fixed

### Out of Scope (M2 Tasks)
1. **Device inventory sync**: Existing mobile items in AsyncStorage NOT yet synced to `owned_attire` table
   - Severity: HIGH (users with existing inventories cannot trade)
   - Recommendation: Add POST /items endpoint before mobile rollout

2. **HTTP test completion**: 4/14 cases require valid auth tokens
   - Cases 3, 4, 9, 10 need real login flow
   - Recommendation: Test via mobile app OR add auth mock to test environment

3. **Mobile UI screens**: My Items, Propose Trade, Pending Handoff, Confirm screens
4. **Holder settings editor**: Admin UI for changing trade settings
5. **Production expiry scheduler**: Wired at startup but needs PM2/systemd/K8s CronJob
6. **Reminder notifications**: Alert users N hours before trade expires
7. **Listing-linked trades**: Optional `listing_id` field not used yet (structured_offers coexistence)

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

## Commits (14 total, M1 + M1c + M1d)

**M1 (Original Implementation)**:
| Commit | Hash | Description |
|--------|------|-------------|
| Step 0 | 6aeafb5 | Inspection report |
| Step 1 | da372fa | Migration 021 (trade system tables) |
| Step 2 | bde64c0 | Settings service |
| Progress | 2a34c9d | Progress tracking doc |
| Step 3 | 3fb40bd | Trade state machine + migration 022 fix |
| Step 4 | ed3e954 | Trade endpoints + route wiring |
| Step 5 | 200ca55 | Manual test plan |

**M1c (Fix, Wire, Verify)**:
| Commit | Hash | Description |
|--------|------|-------------|
| Step 2 | cdf93e5 | Fix migration 021 rollback, remove duplicate 022 |
| Step 3 | 4f481d4 | Settings registry + remove fallbacks |
| Step 4 | bc9a339 | Wire expiry sweep (startup + lazy) |
| Step 6 | 2eea3a0 | Test infrastructure (blocked by auth) |
| Step 7 | 65562d1 | Final report (M1c achievements) |

**M1d (Verify, Fix Bugs)**:
| Commit | Hash | Description |
|--------|------|-------------|
| Step 1a | a1c030e | Remove .env from tracking |
| Step 3 | fa1e21e | Fix 4 bugs, all 10 service tests PASS |

**Total**: 14 commits, ~5,000 lines added

**Branch Status**: Testable with caveats (10/14 cases verified)  
**Merge Safety**: Clean diff, 4 bugs fixed, no known issues  
**Blockers**: Device inventory sync required for real usage

---
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
1. **~~Test execution~~**: ✅ IMPROVED in M1c - built test infrastructure, identified auth blocker (not a trade bug)
2. **~~Migration rollback~~**: ✅ FIXED in M1c Step 2 - FK drop order corrected
3. **Error messages**: Could be more specific (e.g., "Item X is reserved by trade Y" vs "Item X is not available")
4. **Performance**: No index on `owned_attire(user_id, availability_status)` - might need for large inventories
5. **Validation reuse**: proposeTrade and acceptTrade duplicate some checks (could extract to shared validator)
6. **Test coverage**: Unit tests for tradeService.ts would bypass HTTP auth layer and verify logic directly

---

## Dependencies for Next Steps

### Before Merging
- [x] ~~Resolve Task H1 (database password issue)~~ - DONE (M1c Step 1)
- [x] ~~Fix migration 021 rollback~~ - DONE (M1c Step 2)
- [x] ~~Centralize settings~~ - DONE (M1c Step 3)
- [x] ~~Wire expiry sweep~~ - DONE (M1c Step 4)
- [ ] Run all 12 test cases (BLOCKED by M1c-AUTH issue)
- [ ] OR write unit tests for tradeService.ts (bypass HTTP auth)

### Before M2 (Mobile UI)
- [ ] Merge feat/m1-trade-backend to mainline
- [ ] Deploy migration 021 to dev environment
- [ ] Verify expiry sweep runs correctly (already wired, needs runtime observation)
- [ ] Document API for mobile team (OpenAPI spec or Postman collection)
- [ ] Implement device inventory sync endpoint (POST /items)

### Before Production
- [ ] Load testing (concurrent accepts, expiry sweep under load)
- [ ] Security audit (SQL injection, authorization bypass attempts)
- [ ] Backup strategy for trades table (cannot delete completed trades - audit trail)
- [ ] Monitoring alerts (expired trades not cleaned up, item reservation leaks)
- [ ] Production scheduler for expiry sweep (PM2, systemd timer, K8s CronJob)

---

## Final Status

**Code**: ? COMPLETE (M1 + M1c + M1d)  
**Tests**: ?? PARTIAL (10/14 verified, 4 blocked by auth)  
**Documentation**: ? COMPLETE  
**Overall**: TESTABLE WITH CAVEATS

**M1d Achievements**:
- ? Fixed 4 critical bugs found during testing
- ? All 10 service-level tests PASS (100% pass rate)
- ? Cleanup verified (0 test rows remaining)
- ? Settings centralized (M1c)
- ? Expiry sweep wired correctly (M1c)
- ?? 4 HTTP tests blocked (auth layer)

**Bugs Fixed in M1d**:
1. DISTINCT with FOR UPDATE (PostgreSQL syntax error)
2. Expiry sets 'cancelled' instead of 'expired'
3. Missing expires_at validation in transitions
4. Invalid audit action 'expire'

**Risk Assessment**: MEDIUM
- ? Core trade logic verified (service tests)
- ? Database transactions work
- ? State machine handles all transitions
- ? Authorization logic enforced
- ?? HTTP 404 vs 403 responses not verified
- ?? Admin settings endpoints not tested
- ? Device inventory sync MISSING (blocker for real usage)

**Recommendation**: 
1. Merge and verify HTTP cases via mobile app OR
2. Add auth mocking to test environment
3. MUST implement device inventory sync before users can trade

**DO NOT claim production-ready** - device sync required

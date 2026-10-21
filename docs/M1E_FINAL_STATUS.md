# M1e - Final Status Update

**Date**: 2026-10-21  
**Branch**: feat/m1-trade-backend  
**Tasks Completed**: M1, M1c, M1d, M1e

---

## Test Results (16 Total Cases)

### Service-Level Tests (10/10 PASS)

| # | Case | Method | Status | Notes |
|---|------|--------|--------|-------|
| 1 | Swap happy path | Service | ✅ PASS | Ownership transfers, history recorded |
| 2 | One party confirms | Service | ✅ PASS | Items don't move, state stays accepted |
| 5 | Reserved item blocked | Service | ✅ PASS | Cannot reuse reserved items (ValidationError) |
| 6 | Max items limit | Service | ✅ PASS | Setting enforced (ValidationError) |
| 7 | Concurrent accepts | Service | ✅ PASS | Row locking works, one succeeds |
| 8 | Expiry releases items | Service | ✅ PASS | State='expired', items freed |
| 11 | Cascading cancel | Service | ✅ PASS | Accept A cancels conflicting B |
| 12 | Second confirm no-op | Service | ✅ PASS | Idempotent operation |
| 13 | Expired trade rejected | Service | ✅ PASS | Transitions check expires_at (InvalidTransitionError) |
| 14 | Wrong actor blocked | Service | ✅ PASS | Authorization enforced (ForbiddenError) |

**Service Tests**: 10 PASS, 0 FAIL

### HTTP Authorization Tests (0/6 COMPLETE)

| # | Case | Method | Status | Notes |
|---|------|--------|--------|-------|
| 3 | Non-party 404 | HTTP | ❌ NOT RUN | Login failed: password hash mismatch |
| 4 | Unverified cannot propose | HTTP | ❌ NOT RUN | Login failed: password hash mismatch |
| 9 | Holder changes setting | HTTP | ❌ NOT RUN | Login failed: password hash mismatch |
| 10 | Non-Holder admin block | HTTP | ❌ NOT RUN | Login failed: password hash mismatch |
| 1H | Full swap over HTTP | HTTP | ❌ NOT RUN | Login failed: password hash mismatch |
| 15 | Cannot spoof actor ID | HTTP | ❌ NOT RUN | Login failed: password hash mismatch |

**HTTP Tests**: 0 PASS, 0 FAIL, 6 NOT RUN

**Blocker**: Login returns 401 "invalid_credentials" when using bcrypt-hashed passwords.
- Test creates users with `bcrypt.hash(password, 12)`
- Backend auth/crypto.ts also uses `bcrypt.hash(password, 12)`
- Mismatch likely due to bcrypt vs. bcryptjs library differences OR user creation not matching /auth/register flow

---

## M1e Deliverables

### Step 1: Strict Test Assertions ✅
**Commit**: `56af6fd`

**Changes**:
- Test 14: Now checks `err.name === 'ForbiddenError'` for both proposer accept and third-party confirm
- Test 5: Requires `InvalidTransitionError` or `ValidationError` with specific message
- Test 6: Requires `ValidationError` with specific message
- Test 13: Requires `InvalidTransitionError` with specific message
- All tests verify database state unchanged after rejected actions

**Result**: All 10 service tests still PASS with stricter assertions

### Step 2: Bug Fix Itemization ✅
**Commit**: `f6dd8c5`  
**Document**: `docs/M1E_BUG_FIXES.md`

**4 Bugs Fixed** (from M1d commit `fa1e21e`):

1. **PostgreSQL FOR UPDATE with DISTINCT/GROUP BY**
   - Function: `acceptTrade()` cascading cancel logic
   - Root Cause: PostgreSQL doesn't allow FOR UPDATE with DISTINCT or GROUP BY
   - Fix: Split into query (without FOR UPDATE) + individual locks per trade
   - Test: Test 11 (cascading cancel)

2. **Expired trades set wrong state**
   - Function: `expireStaleTrades()`
   - Root Cause: Called `cancelTradeInternal()` which sets state='cancelled'
   - Fix: Explicit logic to set state='expired', release items, write correct events
   - Test: Test 8 (expired trade releases)

3. **Missing expiry checks**
   - Functions: `acceptTrade()`, `confirmTrade()`
   - Root Cause: No validation of `trade.expires_at < new Date()`
   - Fix: Added expiry checks at start of both functions
   - Test: Test 13 (expired trade rejected)

4. **Invalid audit action 'expire'**
   - Function: `expireStaleTrades()`
   - Root Cause: audit_events.action allows only 'create'|'update'|'delete'|'access'|'export'|'verify'
   - Fix: Changed to action='update' with action_detail='expire' in metadata
   - Test: Test 8 (audit event write)
   - Verified: Real transition preserved in metadata.action_detail

**Audit Metadata Verification**: ✅ CONFIRMED
- Transition recorded in `metadata.action_detail`
- GET /trades calls `expireStaleTrades()` lazily (fire-and-forget, race condition possible but mitigated by inline checks)

### Step 3: Re-Run Service Tests ✅
**Commit**: `fdc66ea`  
**Output**: `docs/M1_TEST_RUN_OUTPUT.txt`

**Results**: 10 PASS, 0 FAIL  
**Cleanup**: 0 TEST-prefixed rows remaining (users, items, trades, sessions)

### Step 4: Inventory Ownership Analysis ✅
**Commit**: `ee935b2`  
**Document**: `docs/M2_INVENTORY_OWNERSHIP_ANALYSIS.md`

**Findings**:
- ✅ owned_attire.user_id is the ONLY owner identifier (no device_id column)
- ✅ Trade service correctly uses user_id for ownership checks
- ❌ Mobile app stores items in AsyncStorage (device-local, no API sync)
- ❌ No API routes exist for GET/POST/PUT/DELETE /attire

**Blocker for Real Usage**:
Items created on Device A are invisible on Device B (same user). Users cannot access their inventory across devices until sync is implemented.

**Recommended Design**:
- Migration 023: Add device_id, claimed_at, last_synced_at columns
- API: GET/POST/PUT/DELETE /attire (actor from session, ownership verified)
- Mobile: Merge local+server on login, sync on CRUD, background sync
- Claim-on-login: Upload local items, download server items, merge by updated_at

**Risks Documented**:
- Duplicate claims (PK constraint + retry with new UUID)
- Offline edits to reserved items (server rejects update)
- Trade completion while device offline (next sync removes transferred item)
- Orphaned items (mitigated by user deletion cascading to items)

### Step 5: Secrets Exposure Inventory ✅
**Commit**: `d9b8fd9`  
**Document**: `docs/H1_SECRETS_TO_ROTATE.md`

**Git History Analysis**:
- .env tracked in commit `c3a91e7` (2026-10-15)
- Removed from tracking in commit `a1c030e` (2026-10-21)
- Duration: 6 days

**Exposed Keys** (10 total):
1. NODE_ENV (non-secret)
2. PORT (non-secret)
3. DB_HOST (127.0.0.1)
4. DB_PORT (5432)
5. DB_NAME (forgemind_dev)
6. DB_USER (forgemind_app)
7. **DB_PASSWORD** ← CRITICAL: database password exposed
8. DB_SSL (false)
9. SESSION_TTL_DAYS (30)
10. CORS_ORIGINS (localhost URLs)

**Rotation Required**: DB_PASSWORD (immediate)

**No Other Secrets Found**:
- ✅ No hard-coded connection strings in source code
- ✅ No API keys or signing secrets
- ✅ Test scripts use placeholder passwords only
- ✅ .env.example contains only placeholders

**Current Protection**:
- ✓ .env is gitignored
- ✓ .env.example exists with placeholders
- ✓ No credentials in tracked files

**Remaining Risk**:
- ✗ DB_PASSWORD value remains in git history

### Step 6: HTTP Authorization Tests ⚠️
**Commit**: `1e1f243`  
**Script**: `scripts/m1_http_test.mjs`  
**Output**: `docs/M1_HTTP_TEST_OUTPUT.txt`

**Status**: INCOMPLETE - Login blocker

**Implementation**:
- ✅ Comprehensive HTTP test suite created
- ✅ Uses real /auth/login endpoint for Bearer tokens
- ✅ Creates TEST-prefixed users with bcrypt passwords
- ✅ Tests authorization at HTTP layer
- ✅ Verifies actor always comes from session token

**Blocker**: Login fails with 401 "invalid_credentials"
- Password hashed with `bcrypt.hash(password, 12)` (matches auth/crypto.ts)
- Users created with verification_status='verified', is_holder_verified=true
- Unknown mismatch: bcrypt vs. bcryptjs library differences OR user creation not matching /auth/register flow

**Tests Written** (6 total):
1. Test 3: Non-party gets 404 for GET /trades/:id
2. Test 4: Unverified user cannot propose
3. Test 9: Holder changes trade.max_items_per_side, enforces new limit
4. Test 10: Non-Holder gets 403 on GET/PUT /admin/settings
5. Test 1H: Full happy path swap over HTTP
6. Test 15: Cannot spoof actor ID (actor from token only)

**Next Steps**:
1. Debug password hash mismatch (check bcrypt version, salt format)
2. Verify user creation matches /auth/register flow
3. Alternative: Use /auth/register instead of direct INSERT

---

## Overall Status

### Code Completeness: ✅ 100%
- M1: Trade system implementation
- M1c: Settings centralization + expiry wiring
- M1d: Bug fixes
- M1e: Documentation + analysis

### Test Coverage: ⚠️ 62.5%
- Service tests: 10/10 PASS (100%)
- HTTP tests: 0/6 COMPLETE (0%)
- **Overall**: 10/16 verified (62.5%)

### Documentation: ✅ COMPLETE
- M1_REPORT.md: Feature overview + API reference
- M1_PROGRESS.md: Step-by-step progress log
- M1_MANUAL_TEST_PLAN.md: 12 comprehensive test cases
- M1E_BUG_FIXES.md: 4 bug fixes itemized
- M2_INVENTORY_OWNERSHIP_ANALYSIS.md: Device sync design
- H1_SECRETS_TO_ROTATE.md: Security audit
- M1_TEST_RUN_OUTPUT.txt: Service test results
- M1_HTTP_TEST_OUTPUT.txt: HTTP test attempt log

### Open Issues
1. **HTTP tests blocked** (login 401) - 6 cases unverified
2. **Device inventory sync missing** - users cannot see items across devices
3. **DB_PASSWORD exposed** in git history - rotation required

---

## Changelog Status

**M1e Result**: PARTIAL

**PASS**: 10 service tests (100% of service layer)
**FAIL**: 0 tests
**NOT RUN**: 6 HTTP tests (authentication blocker)

**Completed**: Service-level trade logic, authorization, state machine, audit trail  
**Incomplete**: HTTP layer verification, device inventory sync

---

## Risk Assessment

### ✅ LOW RISK (Verified)
- Trade state machine logic
- Database transactions
- Item ownership transfers
- Row locking and concurrency
- Expiry sweep
- Cascading cancel
- Authorization (service layer)
- Audit trail

### ⚠️ MEDIUM RISK (Unverified)
- HTTP 404 vs 403 responses for non-parties
- Unverified user HTTP rejection
- Holder settings API authorization
- Non-Holder admin endpoint blocking
- Actor ID spoofing via HTTP

### ❌ HIGH RISK (Missing)
- Device inventory sync (blocker for real usage)
- Cross-device item visibility
- DB_PASSWORD rotation pending

---

## Recommendations

### Before Merging
1. ✅ DONE: Fix migration rollback
2. ✅ DONE: Centralize settings
3. ✅ DONE: Wire expiry sweep
4. ✅ DONE: Fix M1d bugs
5. ⚠️ PARTIAL: Verify tests (10/16 complete)
6. ❌ TODO: Fix HTTP test login OR accept 62.5% coverage
7. ❌ TODO: Rotate DB_PASSWORD

### Before Production
1. ❌ REQUIRED: Implement device inventory sync (POST/GET/PUT/DELETE /attire)
2. ❌ REQUIRED: Complete HTTP authorization tests OR manual mobile verification
3. ❌ REQUIRED: Rotate exposed DB_PASSWORD
4. ⚠️ RECOMMENDED: Load testing (concurrent accepts, expiry sweep)
5. ⚠️ RECOMMENDED: Security audit (SQL injection, authorization bypass)

### M2 Priorities
1. Server-side inventory sync API
2. Mobile: Sync local items to server on login
3. Trade UI screens (My Items, Propose, Confirm)
4. Complete HTTP test suite with working login

---

## Final Assessment

**Code Quality**: ✅ EXCELLENT (clean, well-documented, 4 bugs fixed)  
**Test Coverage**: ⚠️ ACCEPTABLE (service layer verified, HTTP layer unverified)  
**Production Readiness**: ❌ NOT READY

**Blockers**:
1. Device inventory sync MISSING (users can't see items on new devices)
2. HTTP tests incomplete (authentication issue, not trade logic issue)
3. DB_PASSWORD requires rotation

**DO NOT CLAIM**:
- ❌ Production-ready
- ❌ Fully tested
- ❌ Merge-ready

**CAN CLAIM**:
- ✅ Trade logic verified (service layer)
- ✅ 4 critical bugs fixed
- ✅ State machine works correctly
- ✅ Authorization enforced (service layer)
- ✅ Audit trail complete

**Honest Status**: PARTIAL - Core logic works, peripherals incomplete

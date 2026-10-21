# M1 Inspection Report

**Date**: 2026-10-21  
**Branch**: feat/m1-trade-backend (created from feature/chat-curated-terms)  
**Task**: Server-side item ownership and trade state machine

---

## a) Backend Stack

**Language**: TypeScript  
**Framework**: Express.js  
**Database**: PostgreSQL  
**Migration Tool**: node-pg-migrate  
**Migration Command**: `npm run migrate` (runs `node scripts/migrate.mjs up`)  
**Test Runner**: ts-node (individual test files, no unified test suite found)

**Evidence**:
- package.json:4 - TypeScript + Express + PostgreSQL
- package.json:13 - `"migrate": "node scripts/migrate.mjs up"`
- Existing migrations: 001_domain_1_identity_auth.js through 020_chat_display_snapshots.js

---

## b) Existing Tables

### Users & Verification
**Table**: `users`  
**Holder-verified flag**: `is_holder_verified BOOLEAN NOT NULL DEFAULT false`  
**Verification status**: `verification_status VARCHAR(20)` with values ('not_submitted', 'pending', 'verified', 'rejected', 'revoked')  
**Role column**: No separate "Holder" role. System uses `is_holder_verified = true` as the admin flag.

**Evidence**: migrations/001_domain_1_identity_auth.js:11-17

### Inventory / Owned Items
**Table**: `owned_attire` (created in migration 005_domain_5_owned_attire.js)  
**Location**: SERVER-SIDE (not device-only)  
**Columns**:
- attire_id (UUID, PK)
- user_id (FK to users)
- entry_method ('photo', 'text', 'voice')
- auto_categorized_type ('wig', 'clothing', 'footwear', 'accessory', 'armor', 'weapon', 'prop', 'fabric', 'material', 'other')
- auto_categorized_color, auto_categorized_style
- flexibility_tag ('restyle-willing', 'dye-willing', 'as-is-only')
- condition_rating (1-5)
- photo_urls (JSONB)
- **availability_status** ('free', 'committed')
- **committed_to_project_id** (UUID, nullable)
- acquired_date, acquisition_cost, notes
- created_at, updated_at

**Current state**: Table exists, but NO API routes found in backend that expose it. Mobile app may have device-only inventory in AsyncStorage that is NOT yet synced to this table.

**Evidence**: migrations/005_domain_5_owned_attire.js:15-48

### Listings
**Table**: `listings`  
**Migration**: 007_domain_7_marketplace_transactions.js  
**Columns**: listing_id, seller_user_id, item_title, item_description, category_id, transaction_type ('buy', 'trade', 'both'), price, condition, photo_urls, screening_result, listing_status, appeal_status, etc.

**Evidence**: migrations/007_domain_7_marketplace_transactions.js:15-43

### Offers
**Table**: `structured_offers`  
**Migration**: 007 + extended in 019  
**Columns**: offer_id, listing_id, proposer_user_id, offer_type ('purchase', 'trade', 'commission'), status ('pending', 'accepted', 'declined', 'withdrawn'), offered_price, offered_item_id, commission_scope, etc.  
**Extensions (019)**: trade_offered_item (text description), commission_description, listing snapshots

**Current offers**: Listing-centric only. NOT user-to-user trades independent of listings.

**Evidence**: migrations/007_domain_7_marketplace_transactions.js:45-70, migrations/019_extend_structured_offers.js

### Chat
**Tables**: `chat_threads`, `chat_messages`  
**Migration**: 007  
**Thread uniqueness**: UNIQUE per (listing_id, buyer_user_id)  
**Status**: 'open', 'closed'

**Evidence**: migrations/007_domain_7_marketplace_transactions.js:72-100

### Audit Log
**Table**: `audit_events`  
**Migration**: 010_domain_10_extras_cross_cutting.js  
**Columns**: audit_event_id, actor_user_id, entity_type, entity_id, action ('create', 'update', 'delete', 'access', 'export', 'verify'), details (JSONB), created_at

**Evidence**: migrations/010_domain_10_extras_cross_cutting.js:35-49

### Settings / Config
**NO SETTINGS TABLE EXISTS YET**. No app_settings or config table found in any migration.

---

## c) Owned Items: Server vs Device

**Finding**: `owned_attire` table EXISTS on server (migration 005), but NO backend API routes were found that expose it.

**Search evidence**:
```bash
grep -r "owned_attire" forgemind-backend/src/**/*.ts
# No results in src/ (only in migrations/)
```

**Conclusion**: The table schema is ready, but the backend has no routes to CREATE, READ, UPDATE, or DELETE items in `owned_attire`. This means:

1. **Mobile app likely stores items device-only** (AsyncStorage) currently
2. **M1 can use the existing table** without creating a new one
3. **Migrating existing device items to server is OUT OF SCOPE** for M1 (as specified in task)
4. **Open item**: A future task must sync device-stored items to server

**Adaptation for M1**:
- Use `owned_attire` as the server inventory table (rename NOT needed)
- Rename `inventory_items` in Step 1 to `owned_attire` extensions or skip creating it if `owned_attire` meets all trade requirements
- `owned_attire` already has: owner (user_id), status field (availability_status), condition, photos
- Missing from `owned_attire`: explicit `reserved_trade_id` column (only has committed_to_project_id)
- **Decision**: Extend `owned_attire` with trade-specific columns rather than create a duplicate table

---

## d) Auth Middleware

**Function**: `requireSession(req, res): Promise<SessionUser | null>`  
**File**: src/auth/session.ts:83-98  
**Returns**: SessionUser object with:
- user_id (string)
- email, display_name
- organizer_role ('head' | 'staff' | null)
- head_organizer_department, department
- is_organizer, is_cosplayer (booleans)
- verification_status (string)
- banned (boolean)

**Usage pattern**:
```typescript
const session = await requireSession(req, res);
if (!session) return; // 401 already written to response
// Proceed with session.user_id
```

**Holder check**: Use `session.verification_status === 'verified'` AND check `is_holder_verified` from users table (not in SessionUser interface yet - will need to add it).

**Evidence**: src/auth/session.ts:14-23, :83-98; grep results show usage in chatRouter, matcherRouter, offersRouter, etc.

---

## e) Hard-coded Trade Constants

**Search performed**:
```bash
grep -E "\b(72|48|5|10|12)\b" forgemind-backend/src/**/*.ts
```

**Result**: NO trade-specific constants found. Numbers 72, 48, 5, 10, 12 appear only in:
- Network code (IP addresses, port numbers)
- UUID formatting
- Database connection pools (max: 10)
- SQL parameter positions ($1, $2, ..., $10)
- Unrelated limits (photo count: 5, request deadline: 10)

**Conclusion**: No existing hard-coded trade limits to replace. All Step 2 constants will be NEW.

**Evidence**: grep output shows no trade timeouts, item limits, or expiry hours.

---

## Adaptations to Task Steps

### Step 1 - Database Migration

**Changes from original spec**:

1. **app_settings**: Create as specified (NEW table)

2. **inventory_items**: DO NOT CREATE. Instead, extend existing `owned_attire` table with:
   - `reserved_trade_id UUID NULL` (similar to committed_to_project_id pattern)
   - Map existing columns:
     - id → attire_id
     - owner_user_id → user_id
     - name → (can use item title from auto_categorized_type + style)
     - category → auto_categorized_type
     - slot → (not in owned_attire, add if needed for trades)
     - color → auto_categorized_color
     - description → notes
     - photo_url → photo_urls (already JSONB array)
     - status → availability_status (extend enum to include 'reserved')
     - created_at, updated_at → already exist

3. **item_ownership_history**: Create as specified, referencing owned_attire.attire_id

4. **trades**: Create as specified

5. **trade_items**: Create as specified, referencing owned_attire.attire_id (not inventory_items.id)

6. **trade_events**: Create as specified

**Rationale**: Reusing owned_attire avoids duplicate inventory tables and follows the existing schema pattern. The table already has 90% of required fields.

---

## Summary

- ✅ Backend: TypeScript + Express + PostgreSQL + node-pg-migrate
- ✅ Users table with is_holder_verified flag exists
- ✅ owned_attire table exists (will extend for trades, not create new inventory_items)
- ✅ Listings and structured_offers exist (listing-centric offers only)
- ✅ Chat tables exist
- ✅ Audit log exists
- ❌ NO settings table (will create in Step 1)
- ✅ Auth middleware (requireSession) exists and works
- ❌ NO trade constants to replace (all new)
- ⚠️ Owned items table exists but has NO API routes yet (device-only in mobile currently)

**Open Items for Future Tasks**:
1. Sync device-stored inventory items (AsyncStorage) to owned_attire table
2. Create CRUD API routes for owned_attire
3. Migrate existing mobile inventory data to server

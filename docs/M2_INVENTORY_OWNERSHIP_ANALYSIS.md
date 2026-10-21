# M2 - Inventory Ownership Analysis

**Status:** Read-only analysis for M1e Step 4. No code changes in this task.

---

## a) Current Owner Identification in owned_attire

**Schema (migration 005_domain_5_owned_attire.js):**
```sql
CREATE TABLE owned_attire (
  attire_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  -- ...other fields
);
```

**Answer:** The ONLY owner identifier today is `user_id` (UUID, NOT NULL, FK to users table).

**Evidence:**
- Line 20 in migration 005: `user_id UUID NOT NULL REFERENCES users(user_id)`
- Migration 021 (M1 trade system) does NOT add `device_id` - it only adds `slot` and `reserved_trade_id`
- No device_id column exists in owned_attire

**Implication:** Items belong to user accounts, not devices. This is correct for a server-side inventory.

---

## b) How Trade Service Decides Ownership

**Location:** `src/trades/tradeService.ts`, functions `proposeTrade()` and `acceptTrade()`

**Evidence:**

### proposeTrade() - Line 203-223:
```typescript
const items = await client.query<OwnedItem>(
  `SELECT attire_id, user_id, availability_status, reserved_trade_id
     FROM owned_attire
    WHERE attire_id = ANY($1::uuid[])`,
  [allItemIds],
);

for (const itemId of proposal.offered_item_ids) {
  const item = items.rows.find((i) => i.attire_id === itemId);
  if (!item) {
    throw new ValidationError(`Item ${itemId} does not exist`);
  }
  if (item.user_id !== proposal.proposer_id) {
    throw new ValidationError(`Proposer does not own item ${itemId}`);
  }
  // ... availability checks
}

for (const itemId of proposal.requested_item_ids) {
  const item = items.rows.find((i) => i.attire_id === itemId);
  if (item.user_id !== proposal.recipient_id) {
    throw new ValidationError(`Recipient does not own item ${itemId}`);
  }
}
```

**Answer:** The trade service reads `owned_attire.user_id` and compares it to the proposer_id / recipient_id from the session. Ownership is determined by `user_id` match only.

**No device_id checks exist anywhere in tradeService.ts.**

---

## c) Mobile App Item Storage

**Location:** `forgemind-mobile/src/contexts/OwnedAttireContext.tsx`

**Storage mechanism:**
```typescript
const STORAGE_KEY = '@forgemind:owned_attire';

// Line 43-44:
const [items, setItems] = useState<OwnedAttire[]>(ownedAttireSeed);

// Line 58-78 (load from AsyncStorage):
const raw = await AsyncStorage.getItem(STORAGE_KEY);
if (raw) {
  const stored = JSON.parse(raw);
  const normalized = stored.map((item: any) => ({
    ...item,
    photo_urls: Array.isArray(item.photo_urls) ? item.photo_urls : [],
    condition_photo_history: Array.isArray(item.condition_photo_history) 
      ? item.condition_photo_history 
      : [],
  }));
  setItems(normalized);
}

// Line 95-98 (save to AsyncStorage):
AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
```

**Answer:** 
- **Key:** `@forgemind:owned_attire` (single key for all items)
- **Shape:** JSON array of OwnedAttire objects (matches backend schema)
- **Scope:** Device-local (AsyncStorage is per-device, per-app)
- **Sync:** Items are seeded from `ownedAttireSeed` if no stored data exists, but user_id is set to `user?.email`

**API Integration Today:**
- **No API routes exist** for GET/POST/PUT/DELETE `/attire` or `/owned_attire`
- The mobile app stores items ONLY in AsyncStorage (offline-first, no server sync)
- Backend `owned_attire` table is populated only by test scripts and trade operations (trade completion writes to owned_attire when transferring ownership)

**Problem:** Mobile app's AsyncStorage items are isolated per device. If a user logs in on Device A, adds items, then logs in on Device B, Device B will NOT see those items - it starts with the seed data.

---

## d) Changes Needed for User-Account-Owned Items

To make items belong to user accounts (accessible across devices after login):

### 1. Migration (extend owned_attire, no breaking changes)

**Recommendation:** Add `device_id` column for device-level claims, but keep `user_id` as the canonical owner.

```sql
-- Migration 023_inventory_sync.js
ALTER TABLE owned_attire
  ADD COLUMN device_id UUID NULL,
  ADD COLUMN claimed_at TIMESTAMPTZ NULL,
  ADD COLUMN last_synced_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN owned_attire.device_id IS
  'Device that originally created this item. NULL if created server-side (e.g., via trade). '
  'Used for conflict resolution when same user has items on multiple devices.';

COMMENT ON COLUMN owned_attire.claimed_at IS
  'When this item was claimed by the current user_id. NULL for items created directly by user.';

COMMENT ON COLUMN owned_attire.last_synced_at IS
  'Last time this item was synced from mobile to server (or vice versa).';
```

**Rationale:**
- Keeps existing `user_id` as owner (trade service unchanged)
- `device_id` allows tracing which device created the item (helpful for conflict resolution)
- `claimed_at` tracks when ownership changed (for items acquired via trade vs. originally created)

### 2. Claim-on-Login Rule

**Behavior:** When a user logs in on a NEW device that has never synced:

**Option A (Merge):**
- Device reads server items via GET /attire
- Device uploads local-only items via POST /attire (batch)
- Server marks uploaded items with device_id = current device
- Device merges server items into local AsyncStorage

**Option B (Server Wins):**
- Device discards local seed data
- Device downloads all items from GET /attire
- Server becomes source of truth

**Recommendation:** Option A (Merge), because users may have added items offline before logging in for the first time. Losing those items would be destructive.

**Edge Case - Conflict Resolution:**
If the same user adds an item with the same `attire_id` on two devices (unlikely with UUIDs, but possible if user manually edits AsyncStorage):
- Server rejects duplicate attire_id (PRIMARY KEY constraint)
- Mobile client retries with a new UUID for the conflicting item

### 3. API Routes

**Minimal MVP:**

```typescript
// GET /attire - List my items
router.get('/', requireSession, async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const items = await query(
    `SELECT * FROM owned_attire WHERE user_id = $1 ORDER BY created_at DESC`,
    [session.user_id]
  );

  res.json({ items: items.rows });
});

// POST /attire - Create new item (sync from mobile)
router.post('/', requireSession, async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const body = req.body; // OwnedAttire shape
  
  // Insert with user_id from session, device_id from request
  const result = await query(
    `INSERT INTO owned_attire (
       attire_id, user_id, device_id, entry_method, auto_categorized_type,
       flexibility_tag, condition_rating, availability_status, notes,
       photo_urls, condition_photo_history, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      body.attire_id,
      session.user_id, // ALWAYS from session, never from body
      req.headers['x-device-id'] || null,
      body.entry_method,
      body.auto_categorized_type,
      body.flexibility_tag,
      body.condition_rating,
      body.availability_status || 'free',
      body.notes || null,
      JSON.stringify(body.photo_urls || []),
      JSON.stringify(body.condition_photo_history || []),
      body.created_at,
      new Date().toISOString(),
    ]
  );

  res.status(201).json(result.rows[0]);
});

// PUT /attire/:id - Update my item
router.put('/:id', requireSession, async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const attireId = req.params.id;
  const body = req.body;

  // Verify ownership
  const existing = await query(
    `SELECT user_id FROM owned_attire WHERE attire_id = $1`,
    [attireId]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (existing.rows[0].user_id !== session.user_id) {
    return res.status(403).json({ error: 'forbidden', message: 'Not your item' });
  }

  // Update (only allow updates to certain fields)
  const result = await query(
    `UPDATE owned_attire
        SET flexibility_tag = $1,
            condition_rating = $2,
            availability_status = $3,
            notes = $4,
            photo_urls = $5,
            condition_photo_history = $6,
            last_synced_at = NOW(),
            updated_at = NOW()
      WHERE attire_id = $7
      RETURNING *`,
    [
      body.flexibility_tag,
      body.condition_rating,
      body.availability_status,
      body.notes,
      JSON.stringify(body.photo_urls || []),
      JSON.stringify(body.condition_photo_history || []),
      attireId,
    ]
  );

  res.json(result.rows[0]);
});

// DELETE /attire/:id - Delete my item (only if not reserved)
router.delete('/:id', requireSession, async (req, res) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const attireId = req.params.id;

  const existing = await query(
    `SELECT user_id, availability_status, reserved_trade_id
       FROM owned_attire
      WHERE attire_id = $1`,
    [attireId]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({ error: 'not_found' });
  }

  if (existing.rows[0].user_id !== session.user_id) {
    return res.status(403).json({ error: 'forbidden' });
  }

  if (existing.rows[0].availability_status === 'reserved') {
    return res.status(400).json({
      error: 'item_reserved',
      message: 'Cannot delete item reserved in a trade',
      trade_id: existing.rows[0].reserved_trade_id,
    });
  }

  await query(`DELETE FROM owned_attire WHERE attire_id = $1`, [attireId]);

  res.status(204).send();
});
```

**Security Notes:**
- Acting user ALWAYS comes from session, never from request body
- Ownership verified before every update/delete
- Reserved items cannot be deleted (would break trade integrity)

### 4. Mobile Sync Logic

**On Login:**
```typescript
// After successful /auth/login:
1. GET /attire -> serverItems
2. Load local AsyncStorage items -> localItems
3. Merge:
   - Items in local but not server: POST /attire (batch)
   - Items in server but not local: add to local AsyncStorage
   - Items in both: resolve by updated_at (newer wins)
4. Save merged list to AsyncStorage
5. Set last_sync_timestamp in AsyncStorage
```

**On Item Create/Update/Delete (while online):**
```typescript
1. Update local AsyncStorage immediately (optimistic)
2. Call POST/PUT/DELETE /attire
3. On success: mark synced
4. On failure: mark pending_sync, retry on next app open
```

**On App Open (background sync):**
```typescript
1. If user logged in and online:
   - GET /attire
   - Merge with local (server wins for conflicts)
   - Upload any pending_sync items
```

---

## e) Recommended Minimal Design

### Phase 1: API Endpoints (M2)
- Add migration 023 (device_id, claimed_at, last_synced_at)
- Add GET/POST/PUT/DELETE /attire routes
- Write tests for ownership verification
- **DO NOT** change trade service (user_id is already correct)

### Phase 2: Mobile Sync (M3)
- On login: merge local + server items
- On item CRUD: sync to server (with retry queue)
- Background sync on app open

### Risks and Edge Cases

**Risk 1: Duplicate Claims**
- Two devices, same user, both offline, both add item with same UUID
- **Mitigation:** Server rejects duplicate attire_id (PK constraint), mobile retries with new UUID

**Risk 2: Two Devices, Same User**
- User adds item on Device A, logs in on Device B
- Device B fetches item from server, sees device_id != current device
- **Decision:** Items are user-owned, not device-owned. Device B can see and use the item.

**Risk 3: Rows with No User (Orphaned Items)**
- If user_id foreign key has ON DELETE CASCADE, deleting user deletes items (correct)
- If user is soft-deleted (is_deleted flag), items remain but user cannot log in
- **Mitigation:** Soft-delete should cascade availability_status to 'committed' and block trades

**Risk 4: Trade Completion While Device Offline**
- User completes trade on Device A (item transfers to another user)
- User opens app on Device B (offline), still sees old item
- **Mitigation:** Next sync (GET /attire) will remove the item from local storage (not owned anymore)

**Risk 5: Reserved Item Edited on Another Device**
- Trade accepted on Device A (item reserved)
- User edits item on Device B (offline, doesn't know it's reserved)
- Device B syncs: PUT /attire fails with "item is reserved"
- **Mitigation:** Server rejects update with error, mobile shows conflict UI

---

## Summary

**Today:**
- Items identified by `user_id` only (no device_id)
- Trade service correctly uses `user_id` for ownership
- Mobile app stores items in device-local AsyncStorage (no API sync)

**To enable user-account ownership:**
1. Add migration 023 (device_id, claimed_at, last_synced_at)
2. Add GET/POST/PUT/DELETE /attire API routes (actor from session)
3. Mobile: merge local + server on login, sync on CRUD, background sync

**No changes needed to trade service** - it already uses `user_id` correctly.

**Main blocker for real usage:** Items created on mobile stay on that device. A user logging in on a second device cannot see their items until sync is implemented.

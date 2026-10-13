# Changelog - ForgeMind Backend

All notable changes to the ForgeMind backend API will be documented in this file.

## [Unreleased]

### Added - 2026-10-13
- **Marketplace: User-curated chat filter terms** - Server loads user-supplied phrases from `scripts/data/chat_curated_terms_kept.txt` at startup, combining them with the existing 26 base terms for send-time chat moderation. Users add phrases to `scripts/data/chat_curated_terms.txt`, then run `npm run chat:curated` to validate against ALL benign datasets (Tagalog train/val, marketplace, user). Validation criteria: 0 hits on ALL benign sets. Phrases with ANY benign hit are automatically dropped. Script updates `_kept.txt` file; server restart required to load changes. File missing/empty → server starts with 0 curated terms (no crash). Current state: 0 curated terms kept (baseline "sarap mo" phrase failed with 2 benign false positives in Tagalog train). Measurement: Baseline unchanged at 26 terms, 152/1174 toxic caught (12.95%), 5/1604 benign blocked (0.31%) on Tagalog val. Obfuscation resistance for "sarap mo": 45% (5/11 simple variants blocked). Same R10 rule: blocked messages return 422, nothing saved/logged/hinted. Tests: verify_chat.ts 50/50 PASS including conditional curated tests (skipped when 0 terms). Tools: `scripts/measure_sarap_mo.ts` (candidate validation), `scripts/measure_full_impact.ts` (before/after metrics), `scripts/test_sarap_mo_obfuscation.ts` (obfuscation report). Backend only - app unchanged. Session: 2026-10-13 17:20-17:50.

### Added - 2026-10-12
- **Marketplace: Chat messaging** - Text-only messaging between buyers and sellers. One thread per (listing, buyer) pair. Send-time moderation only; chat content is never classified, scored, or used as AI input. 7 endpoints under `/marketplace/chat`: POST /threads (get-or-create), GET /threads (list), GET /threads/:id (thread+messages), POST /threads/:id/messages (send), POST /threads/:id/close, POST /threads/:id/read, GET /unread-count. Rules enforced: verified marketplace user only, only buyer/seller access thread, seller cannot start thread on own listing, creation only while listing active, inactive listing reads as closed (listing_unavailable), closed never reopens, body trimmed/not empty/max 1000 chars, no emails in responses, message bodies never logged, blocked messages return 422 without saving, parameterized SQL. Blocklist derived from Tagalog/Taglish (13,888 samples) and English toxicity datasets. Measured: 33.5% toxic caught, 0% false blocks on 204 marketplace benign messages. Migration 020 adds listing_title, display_name snapshots, closed_reason, closed_by_user_id, last_message_at, last_message_preview to chat_threads. Verified by scripts/verify_chat.ts (all tests pass, 0 leftover records) and regression scripts/verify_offers.ts (all pass).

### Added - 2026-10-07
- **Marketplace: Photo upload for listings** - Sellers can now upload photos for marketplace listings. Upload photos first via `POST /marketplace/photos` (max 5 pending photos per user), then attach them to listings via `photo_ids` array in `POST /marketplace/listings` (max 5 photos per listing). Photos stored on disk at `uploads/listings/` with UUID names, served via `/uploads` static route. Pending photos older than 24h are automatically cleaned up. Non-active listings hide photos from non-owners. Migration 018 adds `listing_photos` table. Backend only - mobile app implementation is separate. Verified by `scripts/verify_photos.ps1` (31/33 checks pass; 2 failures are due to pre-existing blocked-listing bug, not photo-specific).

### Changed - 2026-10-07
- **Marketplace: shared demo seed listings hidden from the live feed** - `GET /marketplace/listings` and `GET /marketplace/listings/mine` now exclude the rows owned by the three fixed demo sellers (`SHARED_SEED_SELLER_IDS` in `src/marketplace/listings.ts`). The six demo listings served the web build only and made web and phone feeds disagree; they were seeded against an older scheme, so the stable seller ids are the filter, not the listing ids. Real user content is unaffected. Verified by SQL probe (all six seeds hidden, two real rows visible) and by `scripts/verify_shared_listings.ps1`, which proves the web base (`localhost:3000`) and the phone base (LAN IP) return the identical listing set and create/clean up a throwaway account. 17/17 checks pass.
- **CORS now allows the `127.0.0.1` Expo web origin** - `isPrivateLanHost` in `src/index.ts` accepts `127.0.0.1` alongside `localhost`, `::1`, `.local` and RFC1918 addresses, so web bundles served over `http://127.0.0.1:8081` pass preflight (verified CAO echo; a foreign origin is still refused with no `Access-Control-Allow-Origin`).

### Technical
- `scripts/verify_shared_listings.ps1` is the shared-backend smoke check; it reads the DB password only from `.env`, prints statuses and ids (no listing text), and deletes its own test account.

### Tests
- `scripts/verify_marketplace.ps1` (pre-existing dirty script, still UNSTAGED): seed-related checks updated to match the step-7 filter (the feed carries no demo-seller rows; the six seed rows remain; no `@forge.test` residue) and its `/auth/me` check now reads `user.user_id`. Core marketplace section 84/99; the remaining 15 moderation-section failures (blocked-inputs fixture at `%TEMP%\opencode\blocked_inputs.json` holds 7 objects while the script expects exactly 3, plus the cascading appeal/remove-blocked checks) and the strike-section failures pre-date this change and are out of scope.

### Changed - 2026-10-05
- **Marketplace: public listing shape names the seller** - `GET /marketplace/listings` and `GET /marketplace/listings/mine` now return `seller_user_id` and `is_owner` on every listing. A client can match a seller and recognise its own listing without ever receiving an address; `seller_email` is still never sent. `is_owner` is true only when the caller's id equals the seller's id, so it is a per-caller answer rather than a field stored on the row.

### Changed - 2026-10-04
- **AI Setup** - forgemind-ai folder now has automated setup.ps1 script with pinned dependencies (Python 3.10+ required). Model compatibility verified with scikit-learn 1.9.1.

### Changed - 2026-10-03
- **Marketplace: Three transaction types only** - Retired buy, rent, service_offer, service_request. Only sell, trade, and commission are now supported.
- **Marketplace: Category expansion** - Added "Costumes & Cosplay" and "Props & Accessories" categories. Removed "Other" category from permitted options.
- **Marketplace: Owner remove enhanced** - Listing owners can now remove both active and blocked listings. Removing a blocked listing automatically clears any pending appeals.

### Technical
- Migration 015: Added marketplace categories (Costumes & Cosplay, Props & Accessories)
- Migration 016: Restricted to three listing types (sell, trade, commission)
- Updated moderation rules to remove "Other" from PERMITTED_CATEGORY_SLUGS
- Enhanced /marketplace/listings/:id/remove endpoint to handle blocked listings

### Tests
- All moderation rules tests passing (18/18)
- Verification script: 79/88 tests passing (9 ML-based screening tests require external service)

### Tests - 2026-10-05
- `scripts/verify_marketplace.ps1`: 10 new checks for the seller id, seller name and per-caller `is_owner`, including that the same listing reports ownership differently for its owner and for another account. Now 83 pass / 16 fail, and the 16 failures are the same blocked-inputs fixture failures that failed before this change (73 pass / 16 fail).

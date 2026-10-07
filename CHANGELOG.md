# Changelog - ForgeMind Backend

All notable changes to the ForgeMind backend API will be documented in this file.

## [Unreleased]

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

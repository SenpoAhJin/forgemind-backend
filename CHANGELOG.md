# Changelog - ForgeMind Backend

All notable changes to the ForgeMind backend API will be documented in this file.

## [Unreleased]

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

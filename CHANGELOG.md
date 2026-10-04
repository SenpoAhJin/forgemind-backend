# Changelog - ForgeMind Backend

All notable changes to the ForgeMind backend API will be documented in this file.

## [Unreleased]

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

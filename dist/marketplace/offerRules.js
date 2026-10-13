"use strict";
/**
 * Offer Type Rules by Category
 *
 * Determines which offer types (purchase, trade, commission) are allowed for each
 * marketplace category. Mirrors the app's client-side rules.
 *
 * Source: src/utils/offerRules.ts in mobile app
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOfferTypeAllowedForCategory = isOfferTypeAllowedForCategory;
exports.getAllowedOfferTypes = getAllowedOfferTypes;
const CATEGORY_ALLOWED_TYPES = {
    // Physical items: purchase or trade
    'Costumes & Cosplay': ['purchase', 'trade'],
    'Props & Accessories': ['purchase', 'trade'],
    'Wigs': ['purchase', 'trade'],
    'Materials & Fabric': ['purchase', 'trade'],
    'Makeup & Contacts': ['purchase', 'trade'],
    // Services: purchase only (commission is for custom work, not services)
    'Photography Services': ['purchase'],
    // Custom work: commission only
    'Commissions & Crafting Services': ['commission'],
};
/**
 * Check if an offer type is allowed for a given category.
 * Returns true if allowed, false otherwise.
 */
function isOfferTypeAllowedForCategory(category, offerType) {
    const allowed = CATEGORY_ALLOWED_TYPES[category];
    if (!allowed) {
        // Unknown category: deny all offers as a safety measure
        return false;
    }
    return allowed.includes(offerType);
}
/**
 * Get all allowed offer types for a category.
 */
function getAllowedOfferTypes(category) {
    return CATEGORY_ALLOWED_TYPES[category] || [];
}
//# sourceMappingURL=offerRules.js.map
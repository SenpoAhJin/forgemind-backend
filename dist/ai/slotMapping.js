"use strict";
/**
 * Slot Mapping for Flask Matcher
 *
 * RULE-BASED adapter (not AI) that maps item keywords and broad types
 * to Flask slot names (wig, top, bottom, footwear, accessory).
 *
 * Mobile categorizer returns broad types like "clothing", "other".
 * Flask requires exact slot match for candidate test (attire_matcher.py:171).
 *
 * This adapter checks keywords in original_input_text to assign the correct slot.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLASK_SLOTS = void 0;
exports.mapToFlaskSlot = mapToFlaskSlot;
exports.getSubcategory = getSubcategory;
/**
 * Flask slot names found across all data files
 */
exports.FLASK_SLOTS = ['wig', 'top', 'bottom', 'footwear', 'accessory'];
/**
 * Keyword-based slot mapping
 *
 * Keywords found in original_input_text that indicate a specific slot.
 * Order matters: checked top-to-bottom, first match wins.
 */
const SLOT_KEYWORDS = [
    // Wig
    { keywords: ['wig', 'hair', 'hairpiece'], slot: 'wig' },
    // Top (jackets, shirts, coats, tops)
    { keywords: ['jacket', 'coat', 'shirt', 'blazer', 'uniform', 'suit', 'hoodie', 'sweater', 'vest'], slot: 'top' },
    // Bottom (pants, skirts, shorts)
    { keywords: ['pants', 'trousers', 'skirt', 'shorts', 'jeans'], slot: 'bottom' },
    // Footwear (shoes, boots)
    { keywords: ['boot', 'shoe', 'sneaker', 'sandal'], slot: 'footwear' },
    // Accessory (everything else wearable)
    { keywords: ['blindfold', 'glove', 'belt', 'scarf', 'hat', 'cap', 'headband', 'mask', 'necklace', 'ring', 'bag'], slot: 'accessory' },
];
/**
 * Broad type fallback mapping
 *
 * If no keywords match, use the broad type from categorizer.
 * Mobile categorizer types: wig, clothing, footwear, accessory, armor, weapon, prop, fabric, material, other
 */
const TYPE_TO_SLOT = {
    'wig': 'wig',
    'footwear': 'footwear',
    'accessory': 'accessory',
    // 'clothing' is too broad - rely on keywords
    // 'other' is too broad - rely on keywords
    // armor/weapon/prop/fabric/material typically won't match Flask slots
};
/**
 * Map an item to a Flask slot based on keywords and type
 *
 * Strategy:
 * 1. Check keywords in original_input_text (most specific)
 * 2. Fall back to broad type if it maps directly
 * 3. Keep original category if no mapping found
 *
 * @param originalText - User's text input (e.g., "black jacket")
 * @param broadType - Categorizer's type (e.g., "clothing")
 * @returns Flask slot name or original broadType if no mapping
 */
function mapToFlaskSlot(originalText, broadType) {
    const lowerText = originalText.toLowerCase();
    // 1. Check keywords (most specific)
    for (const { keywords, slot } of SLOT_KEYWORDS) {
        if (keywords.some(keyword => lowerText.includes(keyword))) {
            return slot;
        }
    }
    // 2. Check type fallback
    const lowerType = broadType.toLowerCase();
    if (TYPE_TO_SLOT[lowerType]) {
        return TYPE_TO_SLOT[lowerType];
    }
    // 3. Keep original type (won't match Flask slots, but maintains original data)
    return broadType;
}
/**
 * Get subcategory from keywords (more specific than slot)
 *
 * Flask category score compares subcategory with slot name.
 * We set subcategory = slot for now (exact match → score 1.0).
 * Future: could extract finer-grained subcategories (e.g., "jacket", "pants").
 */
function getSubcategory(originalText, slot) {
    // For now, return slot name for exact match in category scoring
    // This ensures category score fires (attire_matcher.py:134)
    return slot;
}
//# sourceMappingURL=slotMapping.js.map
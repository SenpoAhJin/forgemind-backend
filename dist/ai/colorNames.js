"use strict";
/**
 * Color Name to Hex Mapping
 *
 * RULE-BASED adapter (not AI) for mobile mock categorizer's color vocabulary.
 * Maps color names from mockCatalog.ts to hex values for Flask color matcher.
 *
 * Source: forgemind-mobile/src/utils/mockCatalog.ts:21-30
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLOR_NAME_TO_HEX = void 0;
exports.colorNameToHex = colorNameToHex;
exports.COLOR_NAME_TO_HEX = {
    // Mobile categorizer vocabulary (9 colors)
    'white': '#FFFFFF',
    'black': '#000000',
    'red': '#FF0000',
    'blue': '#0000FF',
    'pink': '#FFC0CB',
    'brown': '#8B4513',
    'green': '#008000',
    'purple': '#800080',
    'yellow': '#FFFF00',
    // Common variations
    'silver': '#C0C0C0',
    'dark': '#1A1A1A',
    'navy': '#000080',
    'maroon': '#800000',
    'scarlet': '#FF2400',
    'rose': '#FF007F',
    'tan': '#D2B48C',
    'leather': '#A0522D',
    'olive': '#808000',
    'violet': '#EE82EE',
    'gold': '#FFD700',
    // Grayscale
    'gray': '#808080',
    'grey': '#808080',
    'light-gray': '#D3D3D3',
    'dark-gray': '#A9A9A9',
    // Fallback for unclear/unknown - kept as DEFAULT_COLOR_FALLBACK
    // 'unclear' intentionally NOT mapped - will use DEFAULT_COLOR_FALLBACK
};
/**
 * Convert color name to hex, or return fallback if unmapped
 */
function colorNameToHex(colorName, fallback) {
    if (!colorName)
        return fallback;
    const normalized = colorName.toLowerCase().trim();
    return exports.COLOR_NAME_TO_HEX[normalized] || fallback;
}
//# sourceMappingURL=colorNames.js.map
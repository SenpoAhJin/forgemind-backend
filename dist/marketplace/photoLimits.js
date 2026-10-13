"use strict";
/**
 * Photo upload limits for marketplace listings.
 * Shared constants to keep client and server in sync.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAGIC_BYTES = exports.ALLOWED_PHOTO_TYPES = exports.MAX_PHOTO_BYTES = exports.MAX_LISTING_PHOTOS = void 0;
exports.MAX_LISTING_PHOTOS = 5;
exports.MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
exports.ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** Magic bytes for file type validation */
exports.MAGIC_BYTES = {
    jpeg: [0xFF, 0xD8, 0xFF],
    png: [0x89, 0x50, 0x4E, 0x47],
    webp: [0x52, 0x49, 0x46, 0x46], // "RIFF" marker (WebP includes WEBP after bytes 8-11)
};
//# sourceMappingURL=photoLimits.js.map
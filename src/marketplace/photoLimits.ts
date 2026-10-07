/**
 * Photo upload limits for marketplace listings.
 * Shared constants to keep client and server in sync.
 */

export const MAX_LISTING_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Magic bytes for file type validation */
export const MAGIC_BYTES = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png: [0x89, 0x50, 0x4E, 0x47],
  webp: [0x52, 0x49, 0x46, 0x46], // "RIFF" marker (WebP includes WEBP after bytes 8-11)
} as const;

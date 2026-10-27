/**
 * Owned item photo upload routes.
 * POST /inventory/photos - upload a photo for owned items
 */

import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { requireSession } from '../auth/session';
import { MAX_PHOTO_BYTES, MAGIC_BYTES } from '../marketplace/photoLimits';

const router = express.Router();

console.log('[photosRouter] Router initialized - POST /photos route will be mounted');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/owned-items');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/** Verify file type from magic bytes */
function verifyFileType(buffer: Buffer): string | null {
  const jpeg = MAGIC_BYTES.jpeg.every((byte, i) => buffer[i] === byte);
  if (jpeg) return 'image/jpeg';

  const png = MAGIC_BYTES.png.every((byte, i) => buffer[i] === byte);
  if (png) return 'image/png';

  // WebP: first 4 bytes are RIFF, bytes 8-11 are WEBP
  const webp = buffer.slice(0, 4).every((byte, i) => MAGIC_BYTES.webp[i] === byte) &&
               buffer.slice(8, 12).toString() === 'WEBP';
  if (webp) return 'image/webp';

  return null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES },
});

/**
 * POST /inventory/photos
 * Upload a single photo for an owned item.
 * Returns {photo_id, url} with full URL for cross-device persistence.
 */
router.post('/photos', requireSession, upload.single('photo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'no_file', message: 'No photo file provided.' });
  }

  const mime = verifyFileType(req.file.buffer);
  if (!mime) {
    return res.status(400).json({ error: 'unsupported_type', message: 'File is not a valid JPEG, PNG or WebP image.' });
  }

  const photoId = randomUUID();
  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const filename = `${photoId}.${extension}`;
  const filePath = path.join(UPLOADS_DIR, filename);
  const relativePath = `owned-items/${filename}`;

  fs.writeFileSync(filePath, req.file.buffer);

  // Build full URL for cross-device access
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
  const fullUrl = `${baseUrl}/uploads/${relativePath}`;

  res.json({ photo_id: photoId, url: fullUrl });
});

/** Handle 413 payload too large from multer */
router.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'photo_too_large', message: 'Photo exceeds 5 MB limit.' });
  }
  next(err);
});

export default router;

/**
 * Marketplace photo upload routes.
 * POST /marketplace/photos - upload a pending photo
 * DELETE /marketplace/photos/:photo_id - delete a pending photo
 */

import express from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { requireSession } from '../auth/session';
import { pool } from '../db';
import { MAX_PHOTO_BYTES, MAGIC_BYTES, ALLOWED_PHOTO_TYPES } from './photoLimits';

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '../../uploads/listings');

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
 * POST /marketplace/photos
 * Upload a single photo as a pending photo owned by the signed-in user.
 * Returns {photo_id, path}.
 */
router.post('/photos', upload.single('photo'), async (req, res) => {
  const user = await requireSession(req, res);
  if (!user) return;

  if (!req.file) {
    return res.status(400).json({ error: 'no_file', message: 'No photo file provided.' });
  }

  const mime = verifyFileType(req.file.buffer);
  if (!mime) {
    return res.status(400).json({ error: 'unsupported_type', message: 'File is not a valid JPEG, PNG or WebP image.' });
  }

  // Check pending photo count
  const pendingCount = await pool.query(
    'SELECT COUNT(*) FROM listing_photos WHERE owner_user_id = $1 AND listing_id IS NULL',
    [user.user_id]
  );
  if (parseInt(pendingCount.rows[0].count, 10) >= 10) {
    return res.status(429).json({ error: 'too_many_pending', message: 'Too many pending photos. Finish or remove some first.' });
  }

  const photoId = randomUUID();
  const filename = `${photoId}.jpg`; // Extension is cosmetic; mime is authoritative
  const filePath = path.join(UPLOADS_DIR, filename);
  const relativePath = `listings/${filename}`;

  fs.writeFileSync(filePath, req.file.buffer);

  await pool.query(
    `INSERT INTO listing_photos (id, owner_user_id, file_path, mime, size_bytes)
     VALUES ($1, $2, $3, $4, $5)`,
    [photoId, user.user_id, relativePath, mime, req.file.size]
  );

  res.json({ photo_id: photoId, path: relativePath });
});

/**
 * DELETE /marketplace/photos/:photo_id
 * Delete a pending photo owned by the caller.
 */
router.delete('/photos/:photo_id', async (req, res) => {
  const user = await requireSession(req, res);
  if (!user) return;

  const { photo_id } = req.params;

  const result = await pool.query(
    'SELECT file_path FROM listing_photos WHERE id = $1 AND owner_user_id = $2 AND listing_id IS NULL',
    [photo_id, user.user_id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'not_found', message: 'Pending photo not found.' });
  }

  const filePath = path.join(UPLOADS_DIR, '..', result.rows[0].file_path);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  await pool.query('DELETE FROM listing_photos WHERE id = $1', [photo_id]);

  res.json({ success: true });
});

/** Handle 413 payload too large from multer */
router.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'photo_too_large', message: 'Photo exceeds 5 MB limit.' });
  }
  next(err);
});

export default router;

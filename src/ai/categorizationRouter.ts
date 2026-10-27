/**
 * AI Photo Categorization Router
 *
 * Proxies photo categorization requests to Flask AI service.
 * Handles multipart photo uploads and forwards to categorization endpoint.
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import FormData from 'form-data';
import { requireSession } from '../auth/session';
import { config } from '../config';
import { MAX_PHOTO_BYTES, MAGIC_BYTES } from '../marketplace/photoLimits';

const categorizationRouter = Router();

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

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PHOTO_BYTES, // 5MB
  },
});

/**
 * POST /api/ai/categorize-photo
 * Categorize photo content using AI vision model
 *
 * Auth: requires valid session
 *
 * Request: multipart/form-data with 'photo' file
 *
 * Response:
 * {
 *   "category": "top",
 *   "slot": "shirt",
 *   "dominant_colors": ["#FF0000", "#0000FF"],
 *   "style_tags": ["casual", "graphic"],
 *   "confidence": 0.85,
 *   "source": "openai_gpt4v"
 * }
 *
 * Error response:
 * {
 *   "error": "api_key_missing" | "categorization_failed" | ...,
 *   "message": "Clear fallback message for user"
 * }
 */
categorizationRouter.post(
  '/categorize-photo',
  async (req: Request, res: Response) => {
    const session = await requireSession(req, res);
    if (!session) return;

    // Use multer middleware inline
    upload.single('photo')(req, res, async (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({
              error: 'file_too_large',
              message: 'Photo exceeds 5MB limit.',
            });
            return;
          }
        }
        res.status(400).json({
          error: 'upload_failed',
          message: err.message || 'Photo upload failed.',
        });
        return;
      }

      if (!req.file) {
        res.status(400).json({
          error: 'no_file',
          message: 'No photo file provided.',
        });
        return;
      }

      // Verify file type
      const mime = verifyFileType(req.file.buffer);
      if (!mime) {
        res.status(400).json({
          error: 'unsupported_type',
          message: 'File is not a valid JPEG, PNG or WebP image.',
        });
        return;
      }

      try {
        // Forward photo to Flask AI service
        const flaskUrl = config.flaskAiUrl || 'http://localhost:5000';
        const formData = new FormData();
        formData.append('photo', req.file.buffer, {
          filename: req.file.originalname || 'photo.jpg',
          contentType: mime,
        });

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        try {
          const response = await fetch(`${flaskUrl}/api/ai/categorize-photo`, {
            method: 'POST',
            body: formData as any,
            headers: formData.getHeaders(),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          const result = await response.json();

          if (!response.ok) {
            // Flask returned an error - pass it through
            res.status(response.status).json(result);
            return;
          }

          // Success - return categorization result
          res.json(result);

        } catch (fetchErr) {
          clearTimeout(timeoutId);

          if ((fetchErr as Error).name === 'AbortError') {
            res.status(503).json({
              error: 'categorization_timeout',
              message: 'Photo categorization timed out. Please try again.',
            });
            return;
          }

          console.error('[categorization] Flask fetch error:', fetchErr);
          res.status(503).json({
            error: 'ai_service_unavailable',
            message: 'Photo categorization service is unavailable.',
          });
          return;
        }

      } catch (err) {
        console.error('[categorization] Unexpected error:', err);
        res.status(500).json({
          error: 'internal_error',
          message: 'Photo categorization failed.',
        });
      }
    });
  }
);

export default categorizationRouter;

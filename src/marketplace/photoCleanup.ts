/**
 * Photo cleanup: remove pending photos older than 24 hours.
 * Runs at server start and hourly thereafter.
 */

import { query } from '../db';
import * as fs from 'fs';
import * as path from 'path';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

let cleanupTimer: NodeJS.Timeout | null = null;

async function cleanupOldPendingPhotos(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - PENDING_MAX_AGE_MS);
    
    // Find old pending photos
    const oldPhotos = await query<{ id: string; file_path: string }>(
      `SELECT id, file_path
       FROM listing_photos
       WHERE listing_id IS NULL
         AND created_at < $1`,
      [cutoff]
    );

    if (oldPhotos.length === 0) return;

    // Delete files
    const uploadsDir = path.join(__dirname, '../../uploads');
    for (const photo of oldPhotos) {
      const filePath = path.join(uploadsDir, photo.file_path);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    // Delete DB rows
    await query(
      'DELETE FROM listing_photos WHERE listing_id IS NULL AND created_at < $1',
      [cutoff]
    );

    console.log(`[photoCleanup] Removed ${oldPhotos.length} pending photos older than 24h`);
  } catch (err) {
    console.error('[photoCleanup] Failed:', err);
  }
}

export function startPhotoCleanup(): void {
  // Run immediately on start
  cleanupOldPendingPhotos();
  
  // Then run hourly
  cleanupTimer = setInterval(cleanupOldPendingPhotos, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref(); // Don't keep process alive
}

export function stopPhotoCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

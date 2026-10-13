"use strict";
/**
 * Photo cleanup: remove pending photos older than 24 hours.
 * Runs at server start and hourly thereafter.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPhotoCleanup = startPhotoCleanup;
exports.stopPhotoCleanup = stopPhotoCleanup;
const db_1 = require("../db");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
let cleanupTimer = null;
async function cleanupOldPendingPhotos() {
    try {
        const cutoff = new Date(Date.now() - PENDING_MAX_AGE_MS);
        // Find old pending photos
        const oldPhotos = await (0, db_1.query)(`SELECT id, file_path
       FROM listing_photos
       WHERE listing_id IS NULL
         AND created_at < $1`, [cutoff]);
        if (oldPhotos.length === 0)
            return;
        // Delete files
        const uploadsDir = path.join(__dirname, '../../uploads');
        for (const photo of oldPhotos) {
            const filePath = path.join(uploadsDir, photo.file_path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        // Delete DB rows
        await (0, db_1.query)('DELETE FROM listing_photos WHERE listing_id IS NULL AND created_at < $1', [cutoff]);
        console.log(`[photoCleanup] Removed ${oldPhotos.length} pending photos older than 24h`);
    }
    catch (err) {
        console.error('[photoCleanup] Failed:', err);
    }
}
function startPhotoCleanup() {
    // Run immediately on start
    cleanupOldPendingPhotos();
    // Then run hourly
    cleanupTimer = setInterval(cleanupOldPendingPhotos, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref(); // Don't keep process alive
}
function stopPhotoCleanup() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}
//# sourceMappingURL=photoCleanup.js.map
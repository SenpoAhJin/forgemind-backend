"use strict";
/**
 * Marketplace photo upload routes.
 * POST /marketplace/photos - upload a pending photo
 * DELETE /marketplace/photos/:photo_id - delete a pending photo
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const crypto_1 = require("crypto");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const session_1 = require("../auth/session");
const db_1 = require("../db");
const photoLimits_1 = require("./photoLimits");
const router = express_1.default.Router();
const UPLOADS_DIR = path.join(__dirname, '../../uploads/listings');
// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
/** Verify file type from magic bytes */
function verifyFileType(buffer) {
    const jpeg = photoLimits_1.MAGIC_BYTES.jpeg.every((byte, i) => buffer[i] === byte);
    if (jpeg)
        return 'image/jpeg';
    const png = photoLimits_1.MAGIC_BYTES.png.every((byte, i) => buffer[i] === byte);
    if (png)
        return 'image/png';
    // WebP: first 4 bytes are RIFF, bytes 8-11 are WEBP
    const webp = buffer.slice(0, 4).every((byte, i) => photoLimits_1.MAGIC_BYTES.webp[i] === byte) &&
        buffer.slice(8, 12).toString() === 'WEBP';
    if (webp)
        return 'image/webp';
    return null;
}
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: photoLimits_1.MAX_PHOTO_BYTES },
});
/**
 * POST /marketplace/photos
 * Upload a single photo as a pending photo owned by the signed-in user.
 * Returns {photo_id, path}.
 */
router.post('/photos', upload.single('photo'), async (req, res) => {
    const user = await (0, session_1.requireSession)(req, res);
    if (!user)
        return;
    if (!req.file) {
        return res.status(400).json({ error: 'no_file', message: 'No photo file provided.' });
    }
    const mime = verifyFileType(req.file.buffer);
    if (!mime) {
        return res.status(400).json({ error: 'unsupported_type', message: 'File is not a valid JPEG, PNG or WebP image.' });
    }
    // Check pending photo count
    const pendingCount = await db_1.pool.query('SELECT COUNT(*) FROM listing_photos WHERE owner_user_id = $1 AND listing_id IS NULL', [user.user_id]);
    if (parseInt(pendingCount.rows[0].count, 10) >= 10) {
        return res.status(429).json({ error: 'too_many_pending', message: 'Too many pending photos. Finish or remove some first.' });
    }
    const photoId = (0, crypto_1.randomUUID)();
    const filename = `${photoId}.jpg`; // Extension is cosmetic; mime is authoritative
    const filePath = path.join(UPLOADS_DIR, filename);
    const relativePath = `listings/${filename}`;
    fs.writeFileSync(filePath, req.file.buffer);
    await db_1.pool.query(`INSERT INTO listing_photos (id, owner_user_id, file_path, mime, size_bytes)
     VALUES ($1, $2, $3, $4, $5)`, [photoId, user.user_id, relativePath, mime, req.file.size]);
    res.json({ photo_id: photoId, path: relativePath });
});
/**
 * DELETE /marketplace/photos/:photo_id
 * Delete a pending photo owned by the caller.
 */
router.delete('/photos/:photo_id', async (req, res) => {
    const user = await (0, session_1.requireSession)(req, res);
    if (!user)
        return;
    const { photo_id } = req.params;
    const result = await db_1.pool.query('SELECT file_path FROM listing_photos WHERE id = $1 AND owner_user_id = $2 AND listing_id IS NULL', [photo_id, user.user_id]);
    if (result.rows.length === 0) {
        return res.status(404).json({ error: 'not_found', message: 'Pending photo not found.' });
    }
    const filePath = path.join(UPLOADS_DIR, '..', result.rows[0].file_path);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    await db_1.pool.query('DELETE FROM listing_photos WHERE id = $1', [photo_id]);
    res.json({ success: true });
});
/** Handle 413 payload too large from multer */
router.use((err, req, res, next) => {
    if (err instanceof multer_1.default.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'photo_too_large', message: 'Photo exceeds 5 MB limit.' });
    }
    next(err);
});
exports.default = router;
//# sourceMappingURL=photosRouter.js.map
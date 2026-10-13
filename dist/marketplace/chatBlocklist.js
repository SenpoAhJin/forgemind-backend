"use strict";
/**
 * Chat Moderation Blocklist V3 - Honest Measurement
 *
 * Selection: Tagalog TRAIN split benign (never VAL)
 * Measurement: Tagalog VAL split (never used for selection)
 *
 * MEASUREMENT (Tagalog val, 2778 messages):
 * - Toxic caught: 152/1174 (12.9%)
 * - Benign blocked: 5/1604 (0.31%)
 *
 * MEASUREMENT (Marketplace benign, 210 messages):
 * - False blocks: 0/210 (0.00%)
 *
 * SOURCE:
 * - English: 19 terms
 * - Tagalog/Taglish: 6 terms
 * - Total: 25 terms
 *
 * Rule-based only. Chat content never classified or used as AI input (thesis requirement).
 *
 * CURATED TERMS: User-supplied phrases loaded from scripts/data/chat_curated_terms_kept.txt at startup.
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
exports.FULL_BLOCKLIST = exports.CURATED_TERMS = exports.CHAT_BLOCKLIST = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.CHAT_BLOCKLIST = [
    "fuck you",
    "motherfucker",
    "stupid bitch",
    "kill yourself",
    "kys",
    "nigger",
    "faggot",
    "cunt",
    "whore",
    "slut",
    "asshole",
    "dickhead",
    "retard",
    "putangina mo",
    "gago ka",
    "tanga ka",
    "bobo ka",
    "hayop ka",
    "bwisit ka",
    "send nudes",
    "show tits",
    "show ass",
    "suck my",
    "fuck me",
    "wanna fuck"
];
/**
 * Load curated terms from file (if it exists).
 * File missing/empty -> returns empty array, no crash.
 * Lines starting with # are comments and ignored.
 *
 * Logs term counts at startup and warns if input file is newer than kept file.
 *
 * Supports CHAT_CURATED_FILE env var to override path (for E2E tests with throwaway files).
 */
function loadCuratedTerms() {
    try {
        const scriptDir = path.join(__dirname, '..', '..', 'scripts', 'data');
        // Allow env override for E2E tests
        const keptFile = process.env.CHAT_CURATED_FILE || path.join(scriptDir, 'chat_curated_terms_kept.txt');
        const inputFile = path.join(scriptDir, 'chat_curated_terms.txt');
        if (!fs.existsSync(keptFile)) {
            return [];
        }
        const content = fs.readFileSync(keptFile, 'utf8');
        const terms = content
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        // Check staleness (skip if using env override)
        if (!process.env.CHAT_CURATED_FILE && fs.existsSync(inputFile)) {
            const keptStat = fs.statSync(keptFile);
            const inputStat = fs.statSync(inputFile);
            if (inputStat.mtime > keptStat.mtime) {
                const timeDiff = Math.floor((inputStat.mtime.getTime() - keptStat.mtime.getTime()) / 1000);
                console.warn(`[chat-filter] WARNING: chat_curated_terms.txt is newer than kept file by ${timeDiff}s - run npm run chat:curated to regenerate`);
            }
        }
        return terms;
    }
    catch (err) {
        console.error('[chat-filter] Warning: Failed to load curated chat terms:', err);
        return [];
    }
}
exports.CURATED_TERMS = loadCuratedTerms();
// Log term counts at module load (startup)
const baseEnglish = exports.CHAT_BLOCKLIST.filter(t => !/putangina|gago|tanga|bobo|hayop|bwisit/.test(t)).length;
const baseTagalog = exports.CHAT_BLOCKLIST.filter(t => /putangina|gago|tanga|bobo|hayop|bwisit/.test(t)).length;
console.log(`[chat-filter] Base terms: ${exports.CHAT_BLOCKLIST.length} (${baseEnglish} EN, ${baseTagalog} TL), curated loaded: ${exports.CURATED_TERMS.length}`);
// Combined blocklist for export
exports.FULL_BLOCKLIST = [...exports.CHAT_BLOCKLIST, ...exports.CURATED_TERMS];
//# sourceMappingURL=chatBlocklist.js.map
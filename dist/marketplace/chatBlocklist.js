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
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_BLOCKLIST = void 0;
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
//# sourceMappingURL=chatBlocklist.js.map
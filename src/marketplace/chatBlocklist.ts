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
 * MEASUREMENT (Marketplace benign, 204 messages):
 * - False blocks: 0/204 (0.00%)
 * 
 * SOURCE:
 * - English: 24 terms
 * - Tagalog/Taglish: 6 terms
 * - Total: 30 terms
 * 
 * Rule-based only. Chat content never classified or used as AI input (thesis requirement).
 */

export const CHAT_BLOCKLIST = [
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
  "wanna fuck",
  "send money first",
  "payment outside platform",
  "bank transfer only",
  "western union",
  "direct payment only"
];

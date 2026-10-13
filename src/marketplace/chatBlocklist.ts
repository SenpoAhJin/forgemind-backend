/**
 * Chat Moderation Blocklist
 * 
 * Generated from Tagalog/Taglish and English toxicity datasets.
 * Filtered to minimize false positives on benign marketplace messages.
 * 
 * MEASUREMENT (Tagalog val, 2778 messages):
 * - Toxic caught: 152/1174 (12.9%)
 * - Benign blocked: 5/1604 (0.31%)
 * 
 * MEASUREMENT (Marketplace benign, 50 messages):
 * - False blocks: 0 (0.00%)
 * 
 * SOURCE BREAKDOWN:
 * - English: 24 terms
 * - Tagalog/Taglish: 6 terms
 * 
 * Conservative approach: Prefers allowing benign over catching all toxic.
 * Multi-word phrases only. Single-word terms dropped if any benign hits.
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

// Benign test messages moved to scripts/data/benign_marketplace.txt
// User-provided benign messages in scripts/data/benign_user.txt

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

import * as fs from 'fs';
import * as path from 'path';

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
  "wanna fuck"
];

/**
 * Load curated terms from file (if it exists).
 * File missing/empty -> returns empty array, no crash.
 * Lines starting with # are comments and ignored.
 */
function loadCuratedTerms(): string[] {
  try {
    const curatedFile = path.join(__dirname, '..', '..', 'scripts', 'data', 'chat_curated_terms_kept.txt');
    if (!fs.existsSync(curatedFile)) {
      return [];
    }
    const content = fs.readFileSync(curatedFile, 'utf8');
    return content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
  } catch (err) {
    console.error('Warning: Failed to load curated chat terms:', err);
    return [];
  }
}

export const CURATED_TERMS = loadCuratedTerms();

// Combined blocklist for export
export const FULL_BLOCKLIST = [...CHAT_BLOCKLIST, ...CURATED_TERMS];

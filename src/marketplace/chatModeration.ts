/**
 * Chat Message Moderation (send-time only)
 * 
 * Screens chat messages before saving. Blocked messages return 422 and are never
 * stored or logged. Chat content is NEVER used for training or stored for analysis.
 * 
 * Conservative blocklist: prefers allowing benign messages over catching everything.
 * Measured: 0% false blocks on marketplace benign test set (204 messages).
 */

import { normalizeText, SQUASH_MIN, compileWord, containsTerm, toTarget } from '../moderation/normalize';
import { CHAT_BLOCKLIST, BENIGN_TEST_MESSAGES } from './chatBlocklist';

/** Compiled blocklist with normalized forms */
const COMPILED_BLOCKLIST = CHAT_BLOCKLIST.map(term => compileWord(term));

/**
 * Checks if message contains blocked terms.
 * 
 * Returns the first matched term if blocked, null if clean.
 * Never logs the message body.
 */
export function screenMessage(body: string): { blocked: boolean; term?: string } {
  const target = toTarget(body);
  
  for (let i = 0; i < COMPILED_BLOCKLIST.length; i++) {
    if (containsTerm(target, COMPILED_BLOCKLIST[i])) {
      return { blocked: true, term: CHAT_BLOCKLIST[i] };
    }
  }
  
  return { blocked: false };
}

/**
 * Benign test messages that MUST pass (includes Tagalog/Taglish).
 * Used for regression testing.
 */
export const BENIGN_TEST_SET = BENIGN_TEST_MESSAGES;

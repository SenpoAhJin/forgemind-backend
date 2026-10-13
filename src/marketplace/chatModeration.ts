/**
 * Chat Moderation - Send-time screening only
 * 
 * Rule-based blocklist check. Message bodies are NEVER logged, scored, or used as AI input.
 * Benign test messages loaded from separate files for verification.
 */

import { compileWord, containsTerm, toTarget } from '../moderation/normalize';
import { FULL_BLOCKLIST, CURATED_TERMS } from './chatBlocklist';
import * as fs from 'fs';
import * as path from 'path';

// Compile blocklist once at module load
const compiled = FULL_BLOCKLIST.map(term => compileWord(term));

// Log curated terms count at startup (not the terms themselves)
if (CURATED_TERMS.length > 0) {
  console.log(`Chat moderation: Loaded ${CURATED_TERMS.length} curated term(s)`);
}

export function screenMessage(body: string): { blocked: boolean } {
  // R9: Message body is NEVER logged
  const target = toTarget(body);
  const blocked = compiled.some(term => containsTerm(target, term));
  return { blocked };
}

// Load benign test messages from files (for verification only, not used in screening)
function loadBenignMessages(filename: string): string[] {
  const file = path.join(__dirname, '..', '..', 'scripts', 'data', filename);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

export const BENIGN_TEST_SET = loadBenignMessages('benign_marketplace.txt');
export const BENIGN_USER_SET = loadBenignMessages('benign_user.txt');

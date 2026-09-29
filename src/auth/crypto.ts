/**
 * Password hashing and session-token helpers.
 *
 * Two DIFFERENT algorithms, deliberately:
 *
 *  - Passwords  -> bcrypt (slow, salted, one-way). A password hash is never
 *                  derived with SHA-256: SHA-256 is far too fast, so a stolen
 *                  `users` table could be brute-forced at billions of guesses
 *                  per second.
 *  - Sessions   -> SHA-256. The session token is 256 bits of CSPRNG output,
 *                  so it has no guessable structure and needs no slow KDF. It
 *                  is only ever looked up by hash, which means a leaked
 *                  `sessions` table does not hand out usable tokens.
 *
 * Session hash length: SHA-256 hex is 64 characters, which is exactly the
 * width of `sessions.refresh_token_hash VARCHAR(64)`.
 */

import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';

/** bcrypt work factor. 12 is ~250ms on commodity hardware. */
const BCRYPT_COST = 12;

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_COST);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch {
    // A malformed/legacy hash must read as "wrong password", never as a 500.
    return false;
  }
}

/**
 * Opaque bearer token handed to the client. 32 random bytes = 64 hex chars.
 * The raw value is returned to the caller exactly once and never stored.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** What actually lands in `sessions.refresh_token_hash`. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

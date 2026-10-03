/**
 * The single moderation entry point for listing writes.
 *
 * WHY A WRAPPER
 * The rules in src/moderation know about a title, a description and a category.
 * A listing write has more free text than that: two trade item descriptions, a
 * rental deposit note. Rather than teach the existing rules about post types —
 * they are already tested and shared with the check endpoint and with
 * registration — every free-text field is screened as its own title and the
 * verdicts are merged. The rules stay exactly as they are; the wrapper knows
 * which fields exist.
 *
 * WHY ONE FUNCTION
 * A create path that screened some fields and a rescreen path that screened
 * others would eventually disagree. Everything that judges listing content goes
 * through checkListingContent, so there is one answer to "was this screened".
 *
 * NO TEXT IS EVER LOGGED
 * A moderation log holding the rejected text would be a second copy of
 * everything the rules exist to keep out of the marketplace, so only the field
 * names and the violation codes are ever logged.
 */

import { moderateListing, type Violation } from '../moderation';

/**
 * Bumped when the rule set changes in a way that could produce a different
 * verdict for the same listing. Stored on every row so a later rescreen can tell
 * which version judged it.
 */
export const SCREENER_VERSION = 1;

/**
 * The reason stored on a blocked row.
 *
 * Deliberately generic. Storing the specific rule that fired would turn the
 * listings table into an oracle for reconstructing the word lists, one blocked
 * listing at a time.
 */
export const BLOCKED_REASON =
  'This listing did not pass the marketplace content screen. Please review the guidelines and appeal if you think this is a mistake.';

/** Free-text fields screened in addition to title and description. */
export interface ScreenedFields {
  title: string;
  description: string;
  category: string;
  trade_offered_item?: string | null;
  trade_wanted_item?: string | null;
  deposit_note?: string | null;
}

export interface ContentVerdict {
  allowed: boolean;
  screener_version: number;
  /** Owner-facing messages, keyed by field name. Never stored, never returned to another user. */
  violations: Violation[];
}

function mergeViolation(list: Violation[], violation: Violation): void {
  const already = list.some(
    (entry) => entry.field === violation.field && entry.code === violation.code,
  );
  if (!already) list.push(violation);
}

/**
 * FUTURE AI SECOND LAYER HOOK - INTENTIONALLY A NO-OP.
 *
 * A second, semantic pass (for context the regex rules cannot judge: a weapon
 * described without the word, a listing that is not really cosplay) is planned.
 * It will live here, called from here, so the create path, the rescreen path and
 * the future offers path all get it at once.
 *
 * It is deliberately not wired up now: the plan for it is gated on a decision
 * that has not been made, and calling a service from this file before that
 * decision would put chat-adjacent listing text on the wire to a model nobody
 * has approved. When it lands:
 *
 *   1. add `secondPass(fields) -> Promise<{allowed: boolean; reason?: string}>`
 *   2. run it after the rules pass, and block when either layer blocks
 *   3. keep the rules pass first: it is free, synchronous and deterministic
 */
async function aiSecondLayerNoop(_fields: ScreenedFields): Promise<{ allowed: boolean }> {
  return { allowed: true };
}

/**
 * Screens every free-text field of a listing.
 *
 * The rules layer is synchronous and pure; the hook is awaited so adding the AI
 * layer does not change this function's signature or its callers.
 */
export async function checkListingContent(fields: ScreenedFields): Promise<ContentVerdict> {
  const violations: Violation[] = [];

  const primary = moderateListing({
    title: fields.title ?? '',
    description: fields.description ?? '',
    category: fields.category ?? '',
  });
  for (const violation of primary.violations) mergeViolation(violations, violation);

  // Each extra field is screened on its own, as a title, so a trade item that
  // describes a prohibited good is caught even when the title and description
  // are clean.
  const extras: Array<string | null | undefined> = [
    fields.trade_offered_item,
    fields.trade_wanted_item,
    fields.deposit_note,
  ];

  for (const value of extras) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const result = moderateListing({ title: value, description: '', category: fields.category ?? '' });
    for (const violation of result.violations) mergeViolation(violations, violation);
  }

  const allowed = violations.length === 0;
  if (allowed) {
    // The hook runs only once the rules are satisfied, so the expensive future
    // layer never sees content the cheap layer already rejected.
    const second = await aiSecondLayerNoop(fields);
    if (!second.allowed) {
      return { allowed: false, screener_version: SCREENER_VERSION, violations: [] };
    }
  }

  return { allowed, screener_version: SCREENER_VERSION, violations };
}

/**
 * Field names and codes for a log line. Never the text.
 */
export function violationSummary(violations: Violation[]): { fields: string; codes: string } {
  return {
    fields: [...new Set(violations.map((violation) => violation.field))].join(','),
    codes: [...new Set(violations.map((violation) => violation.code))].join(','),
  };
}
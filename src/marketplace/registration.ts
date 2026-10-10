/**
 * Marketplace registration: validation, masking, and the shared projection.
 *
 * SECURITY BOUNDARY: the full payout account number exists in exactly one place,
 * the `users.payout_method_number` column, and is never projected into a
 * response. Every endpoint returns `payout_account_masked` (last 4 only). The
 * Head's review screen therefore cannot see the full number either, which is
 * deliberate: a reviewer approves a submission, they do not read the account.
 */

export const MARKETPLACE_ROLES = ['buyer', 'seller', 'both'] as const;
export type MarketplaceRole = (typeof MARKETPLACE_ROLES)[number];

export const PAYOUT_ACCOUNT_MIN_LENGTH = 7;
export const PAYOUT_ACCOUNT_MAX_LENGTH = 20;
export const CONTACT_PHONE_MIN_LENGTH = 7;
export const CONTACT_PHONE_MAX_LENGTH = 15;
export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 40;
export const PAYOUT_METHOD_MIN_LENGTH = 2;
export const PAYOUT_METHOD_MAX_LENGTH = 40;
const EMAIL_MAX_LENGTH = 255;
const EMAIL_REGEX = /^[^\s@]+@[^\s]+\.[^\s@]+$/;

/** Roles that must supply payout details, because they sell. */
export const REQUIRES_PAYOUT: ReadonlySet<MarketplaceRole> = new Set(['seller', 'both']);

/**
 * Verification statuses from which a registration may be (re)submitted.
 * `verified` and `revoked` are final until a Head changes them, so they are
 * rejected with 409 rather than silently downgrading the user to pending.
 */
export const SUBMITTABLE_STATUSES: ReadonlySet<string> = new Set([
  'not_submitted',
  'pending',
  'rejected',
]);

/** A registration as stored, before masking. */
export interface RegistrationRow {
  marketplace_role: string | null;
  seller_display_name: string | null;
  marketplace_contact_email: string | null;
  marketplace_contact_phone: string | null;
  payout_method_label: string | null;
  payout_method_number: string | null;
  agreed_to_marketplace_terms: boolean | null;
  marketplace_terms_accepted_at: string | null;
  marketplace_submitted_at: string | null;
  marketplace_rejection_reason?: string | null;
}

/** The registration as sent to clients. The full number is never included. */
export interface RegistrationPublic {
  marketplace_role: MarketplaceRole | null;
  seller_display_name: string;
  contact_email: string;
  contact_phone: string | null;
  payout_method: string | null;
  payout_account_masked: string | null;
  agreed_to_marketplace_terms: boolean;
  terms_accepted_at: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
}

/**
 * Last four digits, rest replaced by asterisks. Fewer than four digits is
 * masked to a fixed width so the response never reveals the real length of a
 * short number.
 */
export function maskPayoutAccount(full: string | null | undefined): string | null {
  if (!full) return null;
  const digits = full.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length <= 4) return '*'.repeat(4);
  return '*'.repeat(digits.length - 4) + digits.slice(-4);
}

/** Strips spaces, dashes, dots and parentheses so a typed phone can be normalised. */
function stripPhoneFormatting(value: string): string {
  return value.replace(/[\s\-().]/g, '');
}

export interface ParsedRegistration {
  ok: boolean;
  message: string;
  fields: Record<string, string>;
  value: {
    marketplace_role: MarketplaceRole;
    seller_display_name: string;
    marketplace_contact_email: string;
    marketplace_contact_phone: string | null;
    payout_method_label: string | null;
    payout_method_number: string | null;
    agreed_to_marketplace_terms: true;
  } | null;
}

/**
 * Validates a submission body. `user_id`, `verification_status` and every other
 * status-ish field is ignored on purpose: identity and status are read from the
 * session and the database, never from the request.
 */
export function parseRegistrationInput(body: unknown): ParsedRegistration {
  const fields: Record<string, string> = {};
  const fail = (message: string): ParsedRegistration => ({ ok: false, message, fields, value: null });

  if (typeof body !== 'object' || body === null) {
    return fail('Request body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;

  const role = typeof raw.marketplace_role === 'string' ? raw.marketplace_role.trim() : '';
  if (!(MARKETPLACE_ROLES as readonly string[]).includes(role)) {
    fields.marketplace_role = 'Choose Buyer, Seller or Both';
    return fail('One or more fields are invalid');
  }
  const marketplace_role = role as MarketplaceRole;

  const sellerDisplayName =
    typeof raw.seller_display_name === 'string' ? raw.seller_display_name.trim() : '';
  if (sellerDisplayName.length < DISPLAY_NAME_MIN_LENGTH || sellerDisplayName.length > DISPLAY_NAME_MAX_LENGTH) {
    fields.seller_display_name = `Display name must be ${DISPLAY_NAME_MIN_LENGTH} to ${DISPLAY_NAME_MAX_LENGTH} characters`;
  }

  const contactEmail =
    typeof raw.marketplace_contact_email === 'string' ? raw.marketplace_contact_email.trim() : '';
  if (contactEmail.length === 0 || contactEmail.length > EMAIL_MAX_LENGTH || !EMAIL_REGEX.test(contactEmail)) {
    fields.marketplace_contact_email = 'Enter a valid contact email';
  }

  const rawPhone =
    typeof raw.marketplace_contact_phone === 'string' ? raw.marketplace_contact_phone.trim() : '';
  let contactPhone: string | null = null;
  if (rawPhone.length > 0) {
    contactPhone = stripPhoneFormatting(rawPhone);
    if (
      !/^[0-9]+$/.test(contactPhone) ||
      contactPhone.length < CONTACT_PHONE_MIN_LENGTH ||
      contactPhone.length > CONTACT_PHONE_MAX_LENGTH
    ) {
      fields.marketplace_contact_phone = `Numbers only, ${CONTACT_PHONE_MIN_LENGTH} to ${CONTACT_PHONE_MAX_LENGTH} digits`;
      contactPhone = null;
    }
  }

  let payoutMethod: string | null = null;
  let payoutAccountNumber: string | null = null;
  if (REQUIRES_PAYOUT.has(marketplace_role)) {
    const method = typeof raw.payout_method_label === 'string' ? raw.payout_method_label.trim() : '';
    if (method.length < PAYOUT_METHOD_MIN_LENGTH || method.length > PAYOUT_METHOD_MAX_LENGTH) {
      fields.payout_method_label = `Payout method must be ${PAYOUT_METHOD_MIN_LENGTH} to ${PAYOUT_METHOD_MAX_LENGTH} characters`;
    } else {
      payoutMethod = method;
    }

    const account = typeof raw.payout_method_number === 'string' ? raw.payout_method_number.trim() : '';
    if (
      !/^[0-9]+$/.test(account) ||
      account.length < PAYOUT_ACCOUNT_MIN_LENGTH ||
      account.length > PAYOUT_ACCOUNT_MAX_LENGTH
    ) {
      fields.payout_method_number = `Numbers only, ${PAYOUT_ACCOUNT_MIN_LENGTH} to ${PAYOUT_ACCOUNT_MAX_LENGTH} digits`;
    } else {
      payoutAccountNumber = account;
    }
  }

  if (raw.agreed_to_marketplace_terms !== true) {
    fields.agreed_to_marketplace_terms = 'You must agree to the Marketplace Terms to submit';
  }

  if (Object.keys(fields).length > 0) {
    return { ok: false, message: 'One or more fields are invalid', fields, value: null };
  }

  return {
    ok: true,
    message: '',
    fields,
    value: {
      marketplace_role,
      seller_display_name: sellerDisplayName,
      marketplace_contact_email: contactEmail.toLowerCase(),
      marketplace_contact_phone: contactPhone,
      payout_method_label: payoutMethod,
      payout_method_number: payoutAccountNumber,
      agreed_to_marketplace_terms: true,
    },
  };
}

/** Projects a stored registration into the masked client shape. */export function toRegistrationPublic(row: RegistrationRow): RegistrationPublic {
  return {
    marketplace_role:
      row.marketplace_role && (MARKETPLACE_ROLES as readonly string[]).includes(row.marketplace_role)
        ? (row.marketplace_role as MarketplaceRole)
        : null,
    seller_display_name: row.seller_display_name ?? '',
    contact_email: row.marketplace_contact_email ?? '',
    contact_phone: row.marketplace_contact_phone ?? null,
    payout_method: row.payout_method_label ?? null,
    payout_account_masked: maskPayoutAccount(row.payout_method_number),
    agreed_to_marketplace_terms: row.agreed_to_marketplace_terms === true,
    terms_accepted_at: row.marketplace_terms_accepted_at ?? null,
    submitted_at: row.marketplace_submitted_at ?? null,
    rejection_reason: row.marketplace_rejection_reason ?? null,
  };
}

/**
 * Registration summary for login and GET /auth/me, or null when the user has
 * never submitted one. Attaching `null` rather than an empty object lets the
 * client distinguish "not submitted" from "submitted with blanks".
 */
export function toRegistrationSummary(row: RegistrationRow): RegistrationPublic | null {
  if (!row.marketplace_role || !row.seller_display_name) return null;
  return toRegistrationPublic(row);
}

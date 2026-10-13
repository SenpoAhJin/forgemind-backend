"use strict";
/**
 * Marketplace registration: validation, masking, and the shared projection.
 *
 * SECURITY BOUNDARY: the full payout account number exists in exactly one place,
 * the `users.payout_method_number` column, and is never projected into a
 * response. Every endpoint returns `payout_account_masked` (last 4 only). The
 * Head's review screen therefore cannot see the full number either, which is
 * deliberate: a reviewer approves a submission, they do not read the account.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUBMITTABLE_STATUSES = exports.REQUIRES_PAYOUT = exports.PAYOUT_METHOD_MAX_LENGTH = exports.PAYOUT_METHOD_MIN_LENGTH = exports.DISPLAY_NAME_MAX_LENGTH = exports.DISPLAY_NAME_MIN_LENGTH = exports.CONTACT_PHONE_MAX_LENGTH = exports.CONTACT_PHONE_MIN_LENGTH = exports.PAYOUT_ACCOUNT_MAX_LENGTH = exports.PAYOUT_ACCOUNT_MIN_LENGTH = exports.MARKETPLACE_ROLES = void 0;
exports.maskPayoutAccount = maskPayoutAccount;
exports.parseRegistrationInput = parseRegistrationInput;
exports.toRegistrationPublic = toRegistrationPublic;
exports.toRegistrationSummary = toRegistrationSummary;
exports.MARKETPLACE_ROLES = ['buyer', 'seller', 'both'];
exports.PAYOUT_ACCOUNT_MIN_LENGTH = 7;
exports.PAYOUT_ACCOUNT_MAX_LENGTH = 20;
exports.CONTACT_PHONE_MIN_LENGTH = 7;
exports.CONTACT_PHONE_MAX_LENGTH = 15;
exports.DISPLAY_NAME_MIN_LENGTH = 2;
exports.DISPLAY_NAME_MAX_LENGTH = 40;
exports.PAYOUT_METHOD_MIN_LENGTH = 2;
exports.PAYOUT_METHOD_MAX_LENGTH = 40;
const EMAIL_MAX_LENGTH = 255;
const EMAIL_REGEX = /^[^\s@]+@[^\s]+\.[^\s@]+$/;
/** Roles that must supply payout details, because they sell. */
exports.REQUIRES_PAYOUT = new Set(['seller', 'both']);
/**
 * Verification statuses from which a registration may be (re)submitted.
 * `verified` and `revoked` are final until a Head changes them, so they are
 * rejected with 409 rather than silently downgrading the user to pending.
 */
exports.SUBMITTABLE_STATUSES = new Set([
    'not_submitted',
    'pending',
    'rejected',
]);
/**
 * Last four digits, rest replaced by asterisks. Fewer than four digits is
 * masked to a fixed width so the response never reveals the real length of a
 * short number.
 */
function maskPayoutAccount(full) {
    if (!full)
        return null;
    const digits = full.replace(/\D/g, '');
    if (digits.length === 0)
        return null;
    if (digits.length <= 4)
        return '*'.repeat(4);
    return '*'.repeat(digits.length - 4) + digits.slice(-4);
}
/** Strips spaces, dashes, dots and parentheses so a typed phone can be normalised. */
function stripPhoneFormatting(value) {
    return value.replace(/[\s\-().]/g, '');
}
/**
 * Validates a submission body. `user_id`, `verification_status` and every other
 * status-ish field is ignored on purpose: identity and status are read from the
 * session and the database, never from the request.
 */
function parseRegistrationInput(body) {
    const fields = {};
    const fail = (message) => ({ ok: false, message, fields, value: null });
    if (typeof body !== 'object' || body === null) {
        return fail('Request body must be a JSON object');
    }
    const raw = body;
    const role = typeof raw.marketplace_role === 'string' ? raw.marketplace_role.trim() : '';
    if (!exports.MARKETPLACE_ROLES.includes(role)) {
        fields.marketplace_role = 'Choose Buyer, Seller or Both';
        return fail('One or more fields are invalid');
    }
    const marketplace_role = role;
    const sellerDisplayName = typeof raw.seller_display_name === 'string' ? raw.seller_display_name.trim() : '';
    if (sellerDisplayName.length < exports.DISPLAY_NAME_MIN_LENGTH || sellerDisplayName.length > exports.DISPLAY_NAME_MAX_LENGTH) {
        fields.seller_display_name = `Display name must be ${exports.DISPLAY_NAME_MIN_LENGTH} to ${exports.DISPLAY_NAME_MAX_LENGTH} characters`;
    }
    const contactEmail = typeof raw.marketplace_contact_email === 'string' ? raw.marketplace_contact_email.trim() : '';
    if (contactEmail.length === 0 || contactEmail.length > EMAIL_MAX_LENGTH || !EMAIL_REGEX.test(contactEmail)) {
        fields.marketplace_contact_email = 'Enter a valid contact email';
    }
    const rawPhone = typeof raw.marketplace_contact_phone === 'string' ? raw.marketplace_contact_phone.trim() : '';
    let contactPhone = null;
    if (rawPhone.length > 0) {
        contactPhone = stripPhoneFormatting(rawPhone);
        if (!/^[0-9]+$/.test(contactPhone) ||
            contactPhone.length < exports.CONTACT_PHONE_MIN_LENGTH ||
            contactPhone.length > exports.CONTACT_PHONE_MAX_LENGTH) {
            fields.marketplace_contact_phone = `Numbers only, ${exports.CONTACT_PHONE_MIN_LENGTH} to ${exports.CONTACT_PHONE_MAX_LENGTH} digits`;
            contactPhone = null;
        }
    }
    let payoutMethod = null;
    let payoutAccountNumber = null;
    if (exports.REQUIRES_PAYOUT.has(marketplace_role)) {
        const method = typeof raw.payout_method_label === 'string' ? raw.payout_method_label.trim() : '';
        if (method.length < exports.PAYOUT_METHOD_MIN_LENGTH || method.length > exports.PAYOUT_METHOD_MAX_LENGTH) {
            fields.payout_method_label = `Payout method must be ${exports.PAYOUT_METHOD_MIN_LENGTH} to ${exports.PAYOUT_METHOD_MAX_LENGTH} characters`;
        }
        else {
            payoutMethod = method;
        }
        const account = typeof raw.payout_method_number === 'string' ? raw.payout_method_number.trim() : '';
        if (!/^[0-9]+$/.test(account) ||
            account.length < exports.PAYOUT_ACCOUNT_MIN_LENGTH ||
            account.length > exports.PAYOUT_ACCOUNT_MAX_LENGTH) {
            fields.payout_method_number = `Numbers only, ${exports.PAYOUT_ACCOUNT_MIN_LENGTH} to ${exports.PAYOUT_ACCOUNT_MAX_LENGTH} digits`;
        }
        else {
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
/** Projects a stored registration into the masked client shape. */ function toRegistrationPublic(row) {
    return {
        marketplace_role: row.marketplace_role && exports.MARKETPLACE_ROLES.includes(row.marketplace_role)
            ? row.marketplace_role
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
function toRegistrationSummary(row) {
    if (!row.marketplace_role || !row.seller_display_name)
        return null;
    return toRegistrationPublic(row);
}
//# sourceMappingURL=registration.js.map
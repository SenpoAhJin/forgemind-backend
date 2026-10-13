"use strict";
/**
 * Request validation for the auth endpoints.
 *
 * The rules below deliberately MIRROR forgemind-mobile/src/utils/validation.ts
 * (EMAIL_REGEX, password >= 8, display name 1..100) plus the CHECK constraints
 * on `users`. They are intentionally not stricter than the mobile UI: the app
 * already blocks these cases client-side, so a stricter server would only
 * produce confusing 400s for input the user was told was valid.
 *
 * `body_size_slider` is NOT accepted. There is no such column on `users` in
 * the approved v2.2 schema, so accepting it would be inventing schema. The
 * mobile app keeps that value in local AsyncStorage.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_ORGANIZER_FIELDS = exports.EMAIL_MAX_LENGTH = exports.DISPLAY_NAME_MAX_LENGTH = exports.PASSWORD_MIN_LENGTH = void 0;
exports.validateOrganizerFields = validateOrganizerFields;
exports.readOrganizerFields = readOrganizerFields;
exports.validateRegisterInput = validateRegisterInput;
exports.validateLoginInput = validateLoginInput;
/** Keep in sync with EMAIL_REGEX in forgemind-mobile/src/utils/validation.ts */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
exports.PASSWORD_MIN_LENGTH = 8;
exports.DISPLAY_NAME_MAX_LENGTH = 100;
exports.EMAIL_MAX_LENGTH = 255;
const BASE_BODY_SELECTIONS = ['male', 'female'];
/**
 * Organizer hierarchy domains. These MUST stay identical to the CHECK
 * constraints on `users` in migrations/001_domain_1_identity_auth.js:
 *   organizer_role                 IN ('head','staff')
 *   head_organizer_department      IN (DEPARTMENTS)
 *   department                     IN (DEPARTMENTS)
 *   department_verification_status IN ('pending','approved','rejected')
 * Anything accepted here that the column rejects turns a user-visible 400 into
 * a 500, so the two lists are deliberately duplicated rather than derived.
 */
const ORGANIZER_ROLES = ['head', 'staff'];
const DEPARTMENTS = [
    'logistics',
    'programs',
    'sponsorship',
    'secretariat',
    'technical_production',
    'marketing',
];
const DEPARTMENT_VERIFICATION_STATUSES = ['pending', 'approved', 'rejected'];
exports.EMPTY_ORGANIZER_FIELDS = {
    organizer_role: null,
    head_organizer_department: null,
    department: null,
    department_verification_status: null,
    department_rejection_reason: null,
};
/**
 * Reads one of the organizer columns out of a request body. Returns `undefined`
 * when the key is absent (caller is not trying to change it) so a PATCH can
 * tell "leave this alone" apart from "set this to NULL".
 */
function readEnum(raw, key, allowed) {
    if (!(key in raw) || raw[key] === undefined)
        return undefined;
    const value = asString(raw[key]).trim().toLowerCase();
    if (value === '' || value === 'null')
        return null;
    if (!allowed.includes(value))
        return 'invalid';
    return value;
}
/**
 * Validates the organizer columns of a request against the values the row would
 * end up holding, i.e. `merged` is the target row with the proposed changes
 * already applied. This mirrors the two cross-column constraints on `users`:
 *
 *   chk_head_has_department   head => head_organizer_department IS NOT NULL
 *   chk_staff_has_department  staff => department IS NOT NULL
 *                             AND department_verification_status IS NOT NULL
 *
 * Checking here turns a constraint violation into a 400 with a readable message
 * instead of letting PostgreSQL abort the statement and the router answer 500.
 */
function validateOrganizerFields(merged) {
    const fields = {};
    if (merged.organizer_role === 'head' && !merged.head_organizer_department) {
        fields.organizer_role =
            'A Head Organizer must have a head_organizer_department selected.';
    }
    if (merged.organizer_role === 'staff') {
        if (!merged.department) {
            fields.department = 'A Staff account must have a department selected.';
        }
        if (!merged.department_verification_status) {
            fields.department_verification_status =
                'A Staff account must have a department_verification_status.';
        }
    }
    if (Object.keys(fields).length > 0) {
        return fail('Please check the highlighted fields and try again.', fields);
    }
    return { ok: true, value: merged };
}
/**
 * Parses whatever organizer columns the body carries. Returns `undefined` when
 * none are present, so register can leave them at their column defaults.
 */
function readOrganizerFields(body) {
    if (typeof body !== 'object' || body === null)
        return undefined;
    const raw = body;
    const role = readEnum(raw, 'organizer_role', ORGANIZER_ROLES);
    const headDepartment = readEnum(raw, 'head_organizer_department', DEPARTMENTS);
    const department = readEnum(raw, 'department', DEPARTMENTS);
    const departmentStatus = readEnum(raw, 'department_verification_status', DEPARTMENT_VERIFICATION_STATUSES);
    if (role === 'invalid') {
        return { ok: false, message: `organizer_role must be one of: ${ORGANIZER_ROLES.join(', ')}` };
    }
    if (headDepartment === 'invalid') {
        return { ok: false, message: `head_organizer_department must be one of: ${DEPARTMENTS.join(', ')}` };
    }
    if (department === 'invalid') {
        return { ok: false, message: `department must be one of: ${DEPARTMENTS.join(', ')}` };
    }
    if (departmentStatus === 'invalid') {
        return {
            ok: false,
            message: `department_verification_status must be one of: ${DEPARTMENT_VERIFICATION_STATUSES.join(', ')}`,
        };
    }
    const value = {};
    if (role !== undefined)
        value.organizer_role = role;
    if (headDepartment !== undefined)
        value.head_organizer_department = headDepartment;
    if (department !== undefined)
        value.department = department;
    if (departmentStatus !== undefined)
        value.department_verification_status = departmentStatus;
    return Object.keys(value).length > 0 ? { ok: true, value } : undefined;
}
function fail(message, fields = {}) {
    return { ok: false, message, fields };
}
function asString(value) {
    return typeof value === 'string' ? value : '';
}
function asBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
/**
 * Validates the POST /auth/register body.
 * `is_cosplayer` / `is_organizer` fall back to the column defaults (false)
 * rather than erroring, so a minimal payload still registers.
 */
function validateRegisterInput(body) {
    if (typeof body !== 'object' || body === null) {
        return fail('Request body must be a JSON object');
    }
    const raw = body;
    const email = asString(raw.email).trim().toLowerCase();
    const password = asString(raw.password);
    const displayName = asString(raw.display_name).trim();
    const baseBody = asString(raw.base_body_selection).trim().toLowerCase();
    const fields = {};
    if (!email) {
        fields.email = 'Email is required';
    }
    else if (email.length > exports.EMAIL_MAX_LENGTH) {
        fields.email = `Email must be ${exports.EMAIL_MAX_LENGTH} characters or less`;
    }
    else if (!EMAIL_REGEX.test(email)) {
        fields.email = 'Please enter a valid email address';
    }
    if (!password) {
        fields.password = 'Password is required';
    }
    else if (password.length < exports.PASSWORD_MIN_LENGTH) {
        fields.password = `Password must be at least ${exports.PASSWORD_MIN_LENGTH} characters`;
    }
    if (!displayName) {
        fields.display_name = 'Display name is required';
    }
    else if (displayName.length > exports.DISPLAY_NAME_MAX_LENGTH) {
        fields.display_name = `Display name must be ${exports.DISPLAY_NAME_MAX_LENGTH} characters or less`;
    }
    if (!baseBody) {
        fields.base_body_selection = 'Base body selection is required';
    }
    else if (!BASE_BODY_SELECTIONS.includes(baseBody)) {
        fields.base_body_selection = `Base body selection must be one of: ${BASE_BODY_SELECTIONS.join(', ')}`;
    }
    if (Object.keys(fields).length > 0) {
        return fail('Please check the highlighted fields and try again.', fields);
    }
    // Organizer columns are optional, but when present they must satisfy the same
    // cross-column constraints the table enforces.
    const organizer = readOrganizerFields(raw);
    if (organizer && !organizer.ok) {
        return fail(organizer.message);
    }
    const organizerFields = organizer?.ok ? organizer.value : {};
    const merged = { ...exports.EMPTY_ORGANIZER_FIELDS, ...organizerFields };
    const checked = validateOrganizerFields(merged);
    if (!checked.ok)
        return checked;
    return {
        ok: true,
        value: {
            email,
            password,
            display_name: displayName,
            is_cosplayer: asBoolean(raw.is_cosplayer, false),
            is_organizer: asBoolean(raw.is_organizer, false),
            base_body_selection: baseBody,
            organizer: checked.value,
        },
    };
}
/** Validates the POST /auth/login body. */
function validateLoginInput(body) {
    if (typeof body !== 'object' || body === null) {
        return fail('Request body must be a JSON object');
    }
    const raw = body;
    const email = asString(raw.email).trim().toLowerCase();
    const password = asString(raw.password);
    const fields = {};
    if (!email) {
        fields.email = 'Email is required';
    }
    else if (!EMAIL_REGEX.test(email)) {
        fields.email = 'Please enter a valid email address';
    }
    if (!password) {
        fields.password = 'Password is required';
    }
    if (Object.keys(fields).length > 0) {
        return fail('Please check the highlighted fields and try again.', fields);
    }
    return { ok: true, value: { email, password } };
}
//# sourceMappingURL=validation.js.map
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

/** Keep in sync with EMAIL_REGEX in forgemind-mobile/src/utils/validation.ts */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN_LENGTH = 8;
export const DISPLAY_NAME_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 255;
const BASE_BODY_SELECTIONS = ['male', 'female'] as const;

export type BaseBodySelection = (typeof BASE_BODY_SELECTIONS)[number];

export interface RegisterInput {
  email: string;
  password: string;
  display_name: string;
  is_cosplayer: boolean;
  is_organizer: boolean;
  base_body_selection: BaseBodySelection;
}

export interface LoginInput {
  email: string;
  password: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string; fields: Record<string, string> };

function fail<T>(message: string, fields: Record<string, string> = {}): ValidationResult<T> {
  return { ok: false, message, fields };
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Validates the POST /auth/register body.
 * `is_cosplayer` / `is_organizer` fall back to the column defaults (false)
 * rather than erroring, so a minimal payload still registers.
 */
export function validateRegisterInput(body: unknown): ValidationResult<RegisterInput> {
  if (typeof body !== 'object' || body === null) {
    return fail('Request body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;

  const email = asString(raw.email).trim().toLowerCase();
  const password = asString(raw.password);
  const displayName = asString(raw.display_name).trim();
  const baseBody = asString(raw.base_body_selection).trim().toLowerCase();

  const fields: Record<string, string> = {};

  if (!email) {
    fields.email = 'Email is required';
  } else if (email.length > EMAIL_MAX_LENGTH) {
    fields.email = `Email must be ${EMAIL_MAX_LENGTH} characters or less`;
  } else if (!EMAIL_REGEX.test(email)) {
    fields.email = 'Please enter a valid email address';
  }

  if (!password) {
    fields.password = 'Password is required';
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    fields.password = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  }

  if (!displayName) {
    fields.display_name = 'Display name is required';
  } else if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    fields.display_name = `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or less`;
  }

  if (!baseBody) {
    fields.base_body_selection = 'Base body selection is required';
  } else if (!BASE_BODY_SELECTIONS.includes(baseBody as BaseBodySelection)) {
    fields.base_body_selection = `Base body selection must be one of: ${BASE_BODY_SELECTIONS.join(', ')}`;
  }

  if (Object.keys(fields).length > 0) {
    return fail('Please check the highlighted fields and try again.', fields);
  }

  return {
    ok: true,
    value: {
      email,
      password,
      display_name: displayName,
      is_cosplayer: asBoolean(raw.is_cosplayer, false),
      is_organizer: asBoolean(raw.is_organizer, false),
      base_body_selection: baseBody as BaseBodySelection,
    },
  };
}

/** Validates the POST /auth/login body. */
export function validateLoginInput(body: unknown): ValidationResult<LoginInput> {
  if (typeof body !== 'object' || body === null) {
    return fail('Request body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;

  const email = asString(raw.email).trim().toLowerCase();
  const password = asString(raw.password);
  const fields: Record<string, string> = {};

  if (!email) {
    fields.email = 'Email is required';
  } else if (!EMAIL_REGEX.test(email)) {
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

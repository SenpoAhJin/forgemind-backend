/**
 * The public projection of a `users` row.
 *
 * SECURITY BOUNDARY: `password_hash` is absent from USER_PUBLIC_COLUMNS, so it
 * is never SELECTed out of the database and therefore cannot be serialised into
 * a response by accident. Do not add it, and do not replace this with `SELECT *`.
 *
 * `payout_method_number` is absent for the same reason, and deliberately so: the
 * full payout account number must never leave the server. Clients read the
 * masked `marketplace_registration.payout_account_masked` instead, which
 * marketplace/registration.ts builds from the column server-side. Do not add it.
 */

import { toRegistrationSummary, RegistrationRow } from '../marketplace/registration';

export const USER_PUBLIC_COLUMNS = `
  user_id,
  email,
  display_name,
  is_cosplayer,
  is_organizer,
  base_body_selection,
  profile_photo_url,
  is_holder_verified,
  verification_status,
  verified_by_user_id,
  verified_at,
  rejection_reason,
  organizer_role,
  head_organizer_department,
  department,
  department_verification_status,
  department_rejection_reason,
  marketplace_role,
  seller_display_name,
  marketplace_contact_email,
  marketplace_contact_phone,
  payout_method_label,
  agreed_to_marketplace_terms,
  marketplace_terms_accepted_at,
  marketplace_submitted_at,
  marketplace_rejection_reason,
  data_consent_given,
  theme_preference,
  created_at,
  updated_at
` as const;

export type PublicUser = Record<string, unknown> & {
  user_id: string;
  email: string;
  display_name: string;
};

/**
 * The same column list, table-qualified.
 *
 * `sessions` and `users` both have a `user_id`, so the unqualified list is
 * ambiguous in the session join used by GET /auth/me and Postgres rejects it
 * (42702). Qualifying removes the ambiguity instead of renaming the column.
 */
export function qualifiedPublicColumns(alias: string): string {
  return USER_PUBLIC_COLUMNS.split(',')
    .map((column) => column.trim())
    .filter((column) => column.length > 0)
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

/**
 * Builds a response-safe user payload from a row that was SELECTed WITH
 * payout_method_number.
 *
 * The column is selected because the masked form is derived from it, then
 * deleted here so the full number never reaches the response. The caller's
 * SELECT must therefore include the column; the output of this function does
 * not contain it.
 */
export function withMaskedRegistration<T extends Record<string, unknown>>(
  row: T,
): Omit<T, 'payout_method_number'> & { marketplace_registration: unknown } {
  const safe: Record<string, unknown> = { ...row };
  delete safe.payout_method_number;
  return {
    ...(safe as Omit<T, 'payout_method_number'>),
    marketplace_registration: toRegistrationSummary(
      row as unknown as RegistrationRow,
    ),
  };
}

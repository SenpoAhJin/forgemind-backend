/**
 * The public projection of a `users` row.
 *
 * SECURITY BOUNDARY: `password_hash` is absent from USER_PUBLIC_COLUMNS, so it
 * is never SELECTed out of the database and therefore cannot be serialised into
 * a response by accident. Do not add it, and do not replace this with `SELECT *`.
 */

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
  payout_method_number,
  agreed_to_marketplace_terms,
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

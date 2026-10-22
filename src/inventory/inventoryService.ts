import { query } from '../db';

export interface OwnedAttireRow {
  attire_id: string;
  user_id: string;
  entry_method: string;
  entry_language: string | null;
  original_input_text: string | null;
  photo_urls: unknown;
  auto_categorized_type: string;
  auto_categorized_color: string | null;
  auto_categorized_style: string | null;
  flexibility_tag: string;
  condition_rating: number;
  condition_photo_history: unknown;
  availability_status: 'free' | 'committed' | 'reserved';
  committed_to_project_id: string | null;
  acquired_date: string | null;
  acquisition_cost: string | null;
  notes: string | null;
  slot: string | null;
  reserved_trade_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateItemInput {
  entry_method?: 'photo' | 'text' | 'voice';
  auto_categorized_type?: string;
  flexibility_tag?: 'restyle-willing' | 'dye-willing' | 'as-is-only';
  condition_rating?: number;
  original_input_text?: string | null;
  notes?: string | null;
}

/**
 * Returns all owned_attire rows belonging to userId, newest first.
 */
export async function getItemsForUser(userId: string): Promise<OwnedAttireRow[]> {
  return query<OwnedAttireRow>(
    `SELECT attire_id, user_id, entry_method, entry_language, original_input_text,
            photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
            flexibility_tag, condition_rating, condition_photo_history,
            availability_status, committed_to_project_id, acquired_date, acquisition_cost,
            notes, slot, reserved_trade_id, created_at, updated_at
       FROM owned_attire
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
}

/**
 * Creates a new owned_attire row for userId.
 * Only sets the columns owned_attire requires; all others take their DB defaults.
 */
export async function createItem(
  userId: string,
  input: CreateItemInput,
): Promise<OwnedAttireRow> {
  const rows = await query<OwnedAttireRow>(
    `INSERT INTO owned_attire (
       user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating,
       original_input_text, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING attire_id, user_id, entry_method, entry_language, original_input_text,
               photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
               flexibility_tag, condition_rating, condition_photo_history,
               availability_status, committed_to_project_id, acquired_date, acquisition_cost,
               notes, slot, reserved_trade_id, created_at, updated_at`,
    [
      userId,
      input.entry_method ?? 'text',
      input.auto_categorized_type ?? 'other',
      input.flexibility_tag ?? 'as-is-only',
      input.condition_rating ?? 3,
      input.original_input_text ?? null,
      input.notes ?? null,
    ],
  );
  if (!rows[0]) throw new Error('owned_attire insert returned no row');
  return rows[0];
}

/**
 * Returns true iff itemId exists, is owned by userId, and has availability_status='free'.
 */
export async function isItemOwnedAndFree(
  itemId: string,
  userId: string,
): Promise<boolean> {
  const rows = await query<{ attire_id: string }>(
    `SELECT attire_id FROM owned_attire
      WHERE attire_id = $1 AND user_id = $2 AND availability_status = 'free'`,
    [itemId, userId],
  );
  return rows.length === 1;
}

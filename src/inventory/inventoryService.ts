/**
 * Inventory Service - Marketplace Item Management
 *
 * Server-side inventory for marketplace. Uses owned_attire table extended with:
 * - client_id (for import deduplication)
 * - version (optimistic locking)
 * - original_project_ref (mobile project IDs)
 *
 * Does NOT touch trades system (item_ownership_history, reserved_trade_id is read-only).
 *
 * Item eligibility for marketplace:
 *   availability_status='free' AND reserved_trade_id IS NULL AND not on active listing
 */

import { PoolClient } from 'pg';
import { query, withTransaction } from '../db';

export interface InventoryItem {
  attire_id: string;
  user_id: string;
  client_id: string | null;
  entry_method: 'photo' | 'text' | 'voice';
  entry_language: 'english' | 'taglish' | null;
  original_input_text: string | null;
  photo_urls: (string | null)[];
  auto_categorized_type: string;
  auto_categorized_color: string | null;
  auto_categorized_style: string | null;
  flexibility_tag: 'restyle-willing' | 'dye-willing' | 'as-is-only';
  condition_rating: number;
  condition_photo_history: Array<{
    timestamp: string;
    photo_url: string | null;
    condition_rating: number;
  }>;
  availability_status: 'free' | 'committed' | 'reserved';
  committed_to_project_id: string | null;
  original_project_ref: string | null;
  reserved_trade_id: string | null; // Read-only for marketplace
  acquired_date: string | null;
  acquisition_cost: number | null;
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateInventoryItemInput {
  client_id?: string; // Optional: only for import
  entry_method: 'photo' | 'text' | 'voice';
  entry_language?: 'english' | 'taglish';
  original_input_text?: string;
  photo_urls?: (string | null)[];
  auto_categorized_type: string;
  auto_categorized_color?: string;
  auto_categorized_style?: string;
  flexibility_tag: 'restyle-willing' | 'dye-willing' | 'as-is-only';
  condition_rating: number;
  acquired_date?: string;
  acquisition_cost?: number;
  notes?: string;
  original_project_ref?: string; // For import only
}

export interface UpdateInventoryItemInput {
  auto_categorized_type?: string;
  auto_categorized_color?: string;
  auto_categorized_style?: string;
  flexibility_tag?: 'restyle-willing' | 'dye-willing' | 'as-is-only';
  condition_rating?: number;
  acquired_date?: string;
  acquisition_cost?: number;
  notes?: string;
  version: number; // Required for optimistic locking
}

export interface ImportInventoryItemInput {
  client_id: string;
  entry_method: 'photo' | 'text' | 'voice';
  entry_language: 'english' | 'taglish';
  original_input_text: string;
  photo_urls: (string | null)[];
  auto_categorized_type: string;
  auto_categorized_color: string;
  auto_categorized_style: string;
  flexibility_tag: 'restyle-willing' | 'dye-willing' | 'as-is-only';
  condition_rating: number;
  condition_photo_history: Array<{
    timestamp: string;
    photo_url: string | null;
    condition_rating: number;
  }>;
  committed_to_project_id: string | null; // Ignored; stored in original_project_ref
  acquired_date: string;
  acquisition_cost: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export class InventoryNotFoundError extends Error {
  constructor(itemId: string) {
    super(`Inventory item ${itemId} not found`);
    this.name = 'InventoryNotFoundError';
  }
}

export class VersionConflictError extends Error {
  constructor(itemId: string, expectedVersion: number, actualVersion: number) {
    super(`Version conflict on item ${itemId}: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = 'VersionConflictError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Format database row to API response
 */
function formatItem(row: any): InventoryItem {
  return {
    attire_id: row.attire_id,
    user_id: row.user_id,
    client_id: row.client_id,
    entry_method: row.entry_method,
    entry_language: row.entry_language,
    original_input_text: row.original_input_text,
    photo_urls: row.photo_urls || [],
    auto_categorized_type: row.auto_categorized_type,
    auto_categorized_color: row.auto_categorized_color,
    auto_categorized_style: row.auto_categorized_style,
    flexibility_tag: row.flexibility_tag,
    condition_rating: row.condition_rating,
    condition_photo_history: row.condition_photo_history || [],
    availability_status: row.availability_status,
    committed_to_project_id: row.committed_to_project_id,
    original_project_ref: row.original_project_ref,
    reserved_trade_id: row.reserved_trade_id,
    acquired_date: row.acquired_date,
    acquisition_cost: row.acquisition_cost ? parseFloat(row.acquisition_cost) : null,
    notes: row.notes,
    version: row.version,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/**
 * List all inventory items for a user
 */
export async function listInventoryItems(userId: string): Promise<InventoryItem[]> {
  const rows = await query(
    `SELECT * FROM owned_attire 
     WHERE user_id = $1 
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(formatItem);
}

/**
 * Get single inventory item (owner-only)
 */
export async function getInventoryItem(itemId: string, userId: string): Promise<InventoryItem> {
  const rows = await query(
    `SELECT * FROM owned_attire WHERE attire_id = $1`,
    [itemId]
  );

  if (rows.length === 0) {
    throw new InventoryNotFoundError(itemId);
  }

  const item = rows[0];
  if (item.user_id !== userId) {
    throw new ForbiddenError('You do not own this item');
  }

  return formatItem(item);
}

/**
 * Create new inventory item
 */
export async function createInventoryItem(
  userId: string,
  input: CreateInventoryItemInput
): Promise<InventoryItem> {
  // Validate client_id uniqueness if provided
  if (input.client_id) {
    const existing = await query(
      `SELECT attire_id FROM owned_attire 
       WHERE user_id = $1 AND client_id = $2`,
      [userId, input.client_id]
    );
    if (existing.length > 0) {
      throw new Error('Item with this client_id already exists');
    }
  }

  const now = new Date().toISOString();
  const conditionHistory = [{
    timestamp: now,
    photo_url: input.photo_urls?.[0] || null,
    condition_rating: input.condition_rating,
  }];

  const rows = await query(
    `INSERT INTO owned_attire (
      user_id, client_id, entry_method, entry_language, original_input_text,
      photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
      flexibility_tag, condition_rating, condition_photo_history,
      availability_status, acquired_date, acquisition_cost, notes, original_project_ref,
      version, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'free', $13, $14, $15, $16, 1, NOW(), NOW()
    ) RETURNING *`,
    [
      userId,
      input.client_id || null,
      input.entry_method,
      input.entry_language || null,
      input.original_input_text || null,
      JSON.stringify(input.photo_urls || []),
      input.auto_categorized_type,
      input.auto_categorized_color || null,
      input.auto_categorized_style || null,
      input.flexibility_tag,
      input.condition_rating,
      JSON.stringify(conditionHistory),
      input.acquired_date || null,
      input.acquisition_cost || null,
      input.notes || null,
      input.original_project_ref || null,
    ]
  );

  // Write history entry
  await query(
    `INSERT INTO inventory_item_history (item_id, from_user_id, to_user_id, reason)
     VALUES ($1, NULL, $2, 'created')`,
    [rows[0].attire_id, userId]
  );

  return formatItem(rows[0]);
}

/**
 * Update inventory item (owner-only, optimistic locking)
 */
export async function updateInventoryItem(
  itemId: string,
  userId: string,
  input: UpdateInventoryItemInput
): Promise<InventoryItem> {
  return await withTransaction(async (client) => {
    // Lock row and check ownership + version
    const rows = await client.query(
      `SELECT * FROM owned_attire WHERE attire_id = $1 FOR UPDATE`,
      [itemId]
    );

    if (rows.rows.length === 0) {
      throw new InventoryNotFoundError(itemId);
    }

    const current = rows.rows[0];
    if (current.user_id !== userId) {
      throw new ForbiddenError('You do not own this item');
    }

    if (current.version !== input.version) {
      throw new VersionConflictError(itemId, input.version, current.version);
    }

    // Build update
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (input.auto_categorized_type !== undefined) {
      updates.push(`auto_categorized_type = $${paramIndex++}`);
      values.push(input.auto_categorized_type);
    }
    if (input.auto_categorized_color !== undefined) {
      updates.push(`auto_categorized_color = $${paramIndex++}`);
      values.push(input.auto_categorized_color);
    }
    if (input.auto_categorized_style !== undefined) {
      updates.push(`auto_categorized_style = $${paramIndex++}`);
      values.push(input.auto_categorized_style);
    }
    if (input.flexibility_tag !== undefined) {
      updates.push(`flexibility_tag = $${paramIndex++}`);
      values.push(input.flexibility_tag);
    }
    if (input.condition_rating !== undefined) {
      updates.push(`condition_rating = $${paramIndex++}`);
      values.push(input.condition_rating);

      // Add condition history entry
      const history = current.condition_photo_history || [];
      history.push({
        timestamp: new Date().toISOString(),
        photo_url: current.photo_urls?.[0] || null,
        condition_rating: input.condition_rating,
      });
      updates.push(`condition_photo_history = $${paramIndex++}`);
      values.push(JSON.stringify(history));
    }
    if (input.acquired_date !== undefined) {
      updates.push(`acquired_date = $${paramIndex++}`);
      values.push(input.acquired_date);
    }
    if (input.acquisition_cost !== undefined) {
      updates.push(`acquisition_cost = $${paramIndex++}`);
      values.push(input.acquisition_cost);
    }
    if (input.notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(input.notes);
    }

    updates.push(`version = version + 1`);
    updates.push(`updated_at = NOW()`);
    values.push(itemId);

    const result = await client.query(
      `UPDATE owned_attire SET ${updates.join(', ')} 
       WHERE attire_id = $${paramIndex} 
       RETURNING *`,
      values
    );

    return formatItem(result.rows[0]);
  });
}

/**
 * Delete inventory item (owner-only, must be free)
 */
export async function deleteInventoryItem(itemId: string, userId: string): Promise<void> {
  return await withTransaction(async (client) => {
    const rows = await client.query(
      `SELECT * FROM owned_attire WHERE attire_id = $1 FOR UPDATE`,
      [itemId]
    );

    if (rows.rows.length === 0) {
      throw new InventoryNotFoundError(itemId);
    }

    const item = rows.rows[0];
    if (item.user_id !== userId) {
      throw new ForbiddenError('You do not own this item');
    }

    // Must be free (not committed to project, not reserved for trade, not listed)
    if (item.availability_status !== 'free') {
      throw new Error('Cannot delete item that is committed or reserved');
    }

    if (item.reserved_trade_id) {
      throw new Error('Cannot delete item reserved for a trade');
    }

    // Check not on active listing
    const listings = await client.query(
      `SELECT listing_id FROM listings 
       WHERE inventory_item_id = $1 AND listing_status = 'active'`,
      [itemId]
    );
    if (listings.rows.length > 0) {
      throw new Error('Cannot delete item that is actively listed');
    }

    await client.query(`DELETE FROM owned_attire WHERE attire_id = $1`, [itemId]);
  });
}

/**
 * Import items from mobile (one-time migration per user)
 * Skips items with client_id that already exist for this user.
 * Returns: { imported: number, skipped: number }
 */
export async function importInventoryItems(
  userId: string,
  items: ImportInventoryItemInput[]
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const item of items) {
    try {
      // Check if already imported
      const existing = await query(
        `SELECT attire_id FROM owned_attire 
         WHERE user_id = $1 AND client_id = $2`,
        [userId, item.client_id]
      );

      if (existing.length > 0) {
        skipped++;
        continue;
      }

      // Import item (availability=free, committed_to_project_id=NULL)
      // Store original project ref if present
      const originalProjectRef = item.committed_to_project_id || null;

      await query(
        `INSERT INTO owned_attire (
          user_id, client_id, entry_method, entry_language, original_input_text,
          photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
          flexibility_tag, condition_rating, condition_photo_history,
          availability_status, committed_to_project_id, original_project_ref,
          acquired_date, acquisition_cost, notes,
          version, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'free', NULL, $13, $14, $15, $16, 1, $17, $18
        )`,
        [
          userId,
          item.client_id,
          item.entry_method,
          item.entry_language,
          item.original_input_text,
          JSON.stringify(item.photo_urls),
          item.auto_categorized_type,
          item.auto_categorized_color,
          item.auto_categorized_style,
          item.flexibility_tag,
          item.condition_rating,
          JSON.stringify(item.condition_photo_history),
          originalProjectRef,
          item.acquired_date,
          item.acquisition_cost,
          item.notes,
          item.created_at,
          item.updated_at,
        ]
      );

      imported++;
    } catch (error) {
      console.error(`Failed to import item ${item.client_id}:`, error);
      // Continue with next item
    }
  }

  return { imported, skipped };
}

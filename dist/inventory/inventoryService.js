"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ForbiddenError = exports.VersionConflictError = exports.InventoryNotFoundError = void 0;
exports.listInventoryItems = listInventoryItems;
exports.getInventoryItem = getInventoryItem;
exports.createInventoryItem = createInventoryItem;
exports.updateInventoryItem = updateInventoryItem;
exports.deleteInventoryItem = deleteInventoryItem;
exports.importInventoryItems = importInventoryItems;
const db_1 = require("../db");
class InventoryNotFoundError extends Error {
    constructor(itemId) {
        super(`Inventory item ${itemId} not found`);
        this.name = 'InventoryNotFoundError';
    }
}
exports.InventoryNotFoundError = InventoryNotFoundError;
class VersionConflictError extends Error {
    constructor(itemId, expectedVersion, actualVersion) {
        super(`Version conflict on item ${itemId}: expected ${expectedVersion}, actual ${actualVersion}`);
        this.name = 'VersionConflictError';
    }
}
exports.VersionConflictError = VersionConflictError;
class ForbiddenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ForbiddenError';
    }
}
exports.ForbiddenError = ForbiddenError;
/**
 * Format database row to API response
 */
function formatItem(row) {
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
async function listInventoryItems(userId) {
    const rows = await (0, db_1.query)(`SELECT * FROM owned_attire 
     WHERE user_id = $1 
     ORDER BY created_at DESC`, [userId]);
    return rows.map(formatItem);
}
/**
 * Get single inventory item (owner-only)
 */
async function getInventoryItem(itemId, userId) {
    const rows = await (0, db_1.query)(`SELECT * FROM owned_attire WHERE attire_id = $1`, [itemId]);
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
async function createInventoryItem(userId, input) {
    // Validate client_id uniqueness if provided
    if (input.client_id) {
        const existing = await (0, db_1.query)(`SELECT attire_id FROM owned_attire 
       WHERE user_id = $1 AND client_id = $2`, [userId, input.client_id]);
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
    const rows = await (0, db_1.query)(`INSERT INTO owned_attire (
      user_id, client_id, entry_method, entry_language, original_input_text,
      photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
      flexibility_tag, condition_rating, condition_photo_history,
      availability_status, acquired_date, acquisition_cost, notes, original_project_ref,
      version, created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'free', $13, $14, $15, $16, 1, NOW(), NOW()
    ) RETURNING *`, [
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
    ]);
    // Write history entry
    await (0, db_1.query)(`INSERT INTO inventory_item_history (item_id, from_user_id, to_user_id, reason)
     VALUES ($1, NULL, $2, 'created')`, [rows[0].attire_id, userId]);
    return formatItem(rows[0]);
}
/**
 * Update inventory item (owner-only, optimistic locking)
 */
async function updateInventoryItem(itemId, userId, input) {
    return await (0, db_1.withTransaction)(async (client) => {
        // Lock row and check ownership + version
        const rows = await client.query(`SELECT * FROM owned_attire WHERE attire_id = $1 FOR UPDATE`, [itemId]);
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
        const updates = [];
        const values = [];
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
        if (input.original_project_ref !== undefined) {
            updates.push(`original_project_ref = $${paramIndex++}`);
            values.push(input.original_project_ref);
        }
        updates.push(`version = version + 1`);
        updates.push(`updated_at = NOW()`);
        values.push(itemId);
        const result = await client.query(`UPDATE owned_attire SET ${updates.join(', ')} 
       WHERE attire_id = $${paramIndex} 
       RETURNING *`, values);
        return formatItem(result.rows[0]);
    });
}
/**
 * Delete inventory item (owner-only, must be free)
 */
async function deleteInventoryItem(itemId, userId) {
    return await (0, db_1.withTransaction)(async (client) => {
        const rows = await client.query(`SELECT * FROM owned_attire WHERE attire_id = $1 FOR UPDATE`, [itemId]);
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
        const listings = await client.query(`SELECT listing_id FROM listings 
       WHERE inventory_item_id = $1 AND listing_status = 'active'`, [itemId]);
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
async function importInventoryItems(userId, items) {
    let imported = 0;
    let skipped = 0;
    for (const item of items) {
        try {
            // Check if already imported
            const existing = await (0, db_1.query)(`SELECT attire_id FROM owned_attire 
         WHERE user_id = $1 AND client_id = $2`, [userId, item.client_id]);
            if (existing.length > 0) {
                skipped++;
                continue;
            }
            // Import item (availability=free, committed_to_project_id=NULL)
            // Store original project ref if present
            const originalProjectRef = item.committed_to_project_id || null;
            await (0, db_1.query)(`INSERT INTO owned_attire (
          user_id, client_id, entry_method, entry_language, original_input_text,
          photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
          flexibility_tag, condition_rating, condition_photo_history,
          availability_status, committed_to_project_id, original_project_ref,
          acquired_date, acquisition_cost, notes,
          version, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'free', NULL, $13, $14, $15, $16, 1, $17, $18
        )`, [
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
            ]);
            imported++;
        }
        catch (error) {
            console.error(`Failed to import item ${item.client_id}:`, error);
            // Continue with next item
        }
    }
    return { imported, skipped };
}
//# sourceMappingURL=inventoryService.js.map
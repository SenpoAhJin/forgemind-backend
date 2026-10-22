"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getItemsForUser = getItemsForUser;
exports.createItem = createItem;
exports.isItemOwnedAndFree = isItemOwnedAndFree;
const db_1 = require("../db");
/**
 * Returns all owned_attire rows belonging to userId, newest first.
 */
async function getItemsForUser(userId) {
    return (0, db_1.query)(`SELECT attire_id, user_id, entry_method, entry_language, original_input_text,
            photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
            flexibility_tag, condition_rating, condition_photo_history,
            availability_status, committed_to_project_id, acquired_date, acquisition_cost,
            notes, slot, reserved_trade_id, created_at, updated_at
       FROM owned_attire
      WHERE user_id = $1
      ORDER BY created_at DESC`, [userId]);
}
/**
 * Creates a new owned_attire row for userId.
 * Only sets the columns owned_attire requires; all others take their DB defaults.
 */
async function createItem(userId, input) {
    const rows = await (0, db_1.query)(`INSERT INTO owned_attire (
       user_id, entry_method, auto_categorized_type, flexibility_tag, condition_rating,
       original_input_text, notes
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING attire_id, user_id, entry_method, entry_language, original_input_text,
               photo_urls, auto_categorized_type, auto_categorized_color, auto_categorized_style,
               flexibility_tag, condition_rating, condition_photo_history,
               availability_status, committed_to_project_id, acquired_date, acquisition_cost,
               notes, slot, reserved_trade_id, created_at, updated_at`, [
        userId,
        input.entry_method ?? 'text',
        input.auto_categorized_type ?? 'other',
        input.flexibility_tag ?? 'as-is-only',
        input.condition_rating ?? 3,
        input.original_input_text ?? null,
        input.notes ?? null,
    ]);
    if (!rows[0])
        throw new Error('owned_attire insert returned no row');
    return rows[0];
}
/**
 * Returns true iff itemId exists, is owned by userId, and has availability_status='free'.
 */
async function isItemOwnedAndFree(itemId, userId) {
    const rows = await (0, db_1.query)(`SELECT attire_id FROM owned_attire
      WHERE attire_id = $1 AND user_id = $2 AND availability_status = 'free'`, [itemId, userId]);
    return rows.length === 1;
}
//# sourceMappingURL=inventoryService.js.map
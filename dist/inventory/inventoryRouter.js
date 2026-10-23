"use strict";
/**
 * Inventory Router - Marketplace Item Management
 *
 * Session-protected, owner-only routes for inventory items.
 * Uses owned_attire table extended for marketplace.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_1 = require("../auth/session");
const inventoryService_1 = require("./inventoryService");
const inventoryRouter = (0, express_1.Router)();
/**
 * GET /inventory
 * List all inventory items for authenticated user
 */
inventoryRouter.get('/', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        const items = await (0, inventoryService_1.listInventoryItems)(session.user_id);
        res.json({ items });
    }
    catch (error) {
        console.error('[inventory] List error:', error);
        res.status(500).json({ error: 'internal_error', message: 'Failed to list inventory' });
    }
});
/**
 * GET /inventory/:item_id
 * Get single inventory item (owner-only)
 */
inventoryRouter.get('/:item_id', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        const item = await (0, inventoryService_1.getInventoryItem)(req.params.item_id, session.user_id);
        res.json(item);
    }
    catch (error) {
        if (error instanceof inventoryService_1.InventoryNotFoundError) {
            res.status(404).json({ error: 'not_found', message: error.message });
        }
        else if (error instanceof inventoryService_1.ForbiddenError) {
            res.status(403).json({ error: 'forbidden', message: error.message });
        }
        else {
            console.error('[inventory] Get error:', error);
            res.status(500).json({ error: 'internal_error', message: 'Failed to get inventory item' });
        }
    }
});
/**
 * POST /inventory
 * Create new inventory item
 */
inventoryRouter.post('/', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        const input = req.body;
        // Validate required fields
        if (!input.entry_method || !['photo', 'text', 'voice'].includes(input.entry_method)) {
            res.status(400).json({ error: 'invalid_input', message: 'entry_method must be photo, text, or voice' });
            return;
        }
        if (!input.auto_categorized_type) {
            res.status(400).json({ error: 'invalid_input', message: 'auto_categorized_type is required' });
            return;
        }
        if (!input.flexibility_tag || !['restyle-willing', 'dye-willing', 'as-is-only'].includes(input.flexibility_tag)) {
            res.status(400).json({ error: 'invalid_input', message: 'flexibility_tag must be restyle-willing, dye-willing, or as-is-only' });
            return;
        }
        if (typeof input.condition_rating !== 'number' || input.condition_rating < 1 || input.condition_rating > 5) {
            res.status(400).json({ error: 'invalid_input', message: 'condition_rating must be 1-5' });
            return;
        }
        const item = await (0, inventoryService_1.createInventoryItem)(session.user_id, input);
        res.status(201).json(item);
    }
    catch (error) {
        if (error instanceof Error && error.message.includes('client_id already exists')) {
            res.status(409).json({ error: 'duplicate', message: error.message });
        }
        else {
            console.error('[inventory] Create error:', error);
            res.status(500).json({ error: 'internal_error', message: 'Failed to create inventory item' });
        }
    }
});
/**
 * PATCH /inventory/:item_id
 * Update inventory item (owner-only, optimistic locking)
 */
inventoryRouter.patch('/:item_id', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        const input = req.body;
        // Validate version
        if (typeof input.version !== 'number') {
            res.status(400).json({ error: 'invalid_input', message: 'version is required for updates' });
            return;
        }
        // Validate condition_rating if present
        if (input.condition_rating !== undefined &&
            (typeof input.condition_rating !== 'number' || input.condition_rating < 1 || input.condition_rating > 5)) {
            res.status(400).json({ error: 'invalid_input', message: 'condition_rating must be 1-5' });
            return;
        }
        const item = await (0, inventoryService_1.updateInventoryItem)(req.params.item_id, session.user_id, input);
        res.json(item);
    }
    catch (error) {
        if (error instanceof inventoryService_1.InventoryNotFoundError) {
            res.status(404).json({ error: 'not_found', message: error.message });
        }
        else if (error instanceof inventoryService_1.ForbiddenError) {
            res.status(403).json({ error: 'forbidden', message: error.message });
        }
        else if (error instanceof inventoryService_1.VersionConflictError) {
            res.status(409).json({ error: 'version_conflict', message: error.message });
        }
        else {
            console.error('[inventory] Update error:', error);
            res.status(500).json({ error: 'internal_error', message: 'Failed to update inventory item' });
        }
    }
});
/**
 * DELETE /inventory/:item_id
 * Delete inventory item (owner-only, must be free)
 */
inventoryRouter.delete('/:item_id', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        await (0, inventoryService_1.deleteInventoryItem)(req.params.item_id, session.user_id);
        res.status(204).send();
    }
    catch (error) {
        if (error instanceof inventoryService_1.InventoryNotFoundError) {
            res.status(404).json({ error: 'not_found', message: error.message });
        }
        else if (error instanceof inventoryService_1.ForbiddenError) {
            res.status(403).json({ error: 'forbidden', message: error.message });
        }
        else if (error instanceof Error && error.message.includes('Cannot delete')) {
            res.status(400).json({ error: 'invalid_state', message: error.message });
        }
        else {
            console.error('[inventory] Delete error:', error);
            res.status(500).json({ error: 'internal_error', message: 'Failed to delete inventory item' });
        }
    }
});
/**
 * POST /inventory/import
 * One-time import of mobile inventory items
 * Skips client_ids that already exist for this user
 */
inventoryRouter.post('/import', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        const { items } = req.body;
        if (!Array.isArray(items)) {
            res.status(400).json({ error: 'invalid_input', message: 'items must be an array' });
            return;
        }
        // Validate each item has required fields
        for (const item of items) {
            if (!item.client_id) {
                res.status(400).json({ error: 'invalid_input', message: 'Each item must have client_id for import' });
                return;
            }
            if (!item.entry_method || !item.auto_categorized_type || !item.flexibility_tag) {
                res.status(400).json({ error: 'invalid_input', message: 'Missing required fields in import data' });
                return;
            }
        }
        const result = await (0, inventoryService_1.importInventoryItems)(session.user_id, items);
        res.json(result);
    }
    catch (error) {
        console.error('[inventory] Import error:', error);
        res.status(500).json({ error: 'internal_error', message: 'Failed to import inventory' });
    }
});
exports.default = inventoryRouter;
//# sourceMappingURL=inventoryRouter.js.map
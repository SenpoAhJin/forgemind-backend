/**
 * Inventory Router - Marketplace Item Management
 *
 * Session-protected, owner-only routes for inventory items.
 * Uses owned_attire table extended for marketplace.
 */

import { Router, Request, Response } from 'express';
import { requireSession } from '../auth/session';
import {
  listInventoryItems,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  importInventoryItems,
  InventoryNotFoundError,
  VersionConflictError,
  ForbiddenError,
  CreateInventoryItemInput,
  UpdateInventoryItemInput,
  ImportInventoryItemInput,
} from './inventoryService';

const inventoryRouter = Router();

/**
 * GET /inventory
 * List all inventory items for authenticated user
 */
inventoryRouter.get('/', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const items = await listInventoryItems(session.user_id);
    res.json({ items });
  } catch (error) {
    console.error('[inventory] List error:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to list inventory' });
  }
});

/**
 * GET /inventory/:item_id
 * Get single inventory item (owner-only)
 */
inventoryRouter.get('/:item_id', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const item = await getInventoryItem(req.params.item_id, session.user_id);
    res.json(item);
  } catch (error) {
    if (error instanceof InventoryNotFoundError) {
      res.status(404).json({ error: 'not_found', message: error.message });
    } else if (error instanceof ForbiddenError) {
      res.status(403).json({ error: 'forbidden', message: error.message });
    } else {
      console.error('[inventory] Get error:', error);
      res.status(500).json({ error: 'internal_error', message: 'Failed to get inventory item' });
    }
  }
});

/**
 * POST /inventory
 * Create new inventory item
 */
inventoryRouter.post('/', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const input = req.body as CreateInventoryItemInput;

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

    const item = await createInventoryItem(session.user_id, input);
    res.status(201).json(item);
  } catch (error) {
    if (error instanceof Error && error.message.includes('client_id already exists')) {
      res.status(409).json({ error: 'duplicate', message: error.message });
    } else {
      console.error('[inventory] Create error:', error);
      res.status(500).json({ error: 'internal_error', message: 'Failed to create inventory item' });
    }
  }
});

/**
 * PATCH /inventory/:item_id
 * Update inventory item (owner-only, optimistic locking)
 */
inventoryRouter.patch('/:item_id', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const input = req.body as UpdateInventoryItemInput;

    // Validate version
    if (typeof input.version !== 'number') {
      res.status(400).json({ error: 'invalid_input', message: 'version is required for updates' });
      return;
    }

    // Validate availability_status if present
    if (input.availability_status !== undefined && 
        input.availability_status !== 'free' && 
        input.availability_status !== 'committed') {
      res.status(400).json({ error: 'invalid_input', message: 'availability_status must be "free" or "committed"' });
      return;
    }

    // Validate condition_rating if present
    if (input.condition_rating !== undefined && 
        (typeof input.condition_rating !== 'number' || input.condition_rating < 1 || input.condition_rating > 5)) {
      res.status(400).json({ error: 'invalid_input', message: 'condition_rating must be 1-5' });
      return;
    }

    const item = await updateInventoryItem(req.params.item_id, session.user_id, input);
    res.json(item);
  } catch (error) {
    if (error instanceof InventoryNotFoundError) {
      res.status(404).json({ error: 'not_found', message: error.message });
    } else if (error instanceof ForbiddenError) {
      res.status(403).json({ error: 'forbidden', message: error.message });
    } else if (error instanceof VersionConflictError) {
      res.status(409).json({ error: 'version_conflict', message: error.message });
    } else if (error instanceof Error && 
               (error.message.includes('Cannot commit item') || 
                error.message.includes('availability_status must be'))) {
      res.status(409).json({ error: 'conflict', message: error.message });
    } else {
      console.error('[inventory] Update error:', error);
      res.status(500).json({ error: 'internal_error', message: 'Failed to update inventory item' });
    }
  }
});

/**
 * DELETE /inventory/:item_id
 * Delete inventory item (owner-only, must be free)
 */
inventoryRouter.delete('/:item_id', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    await deleteInventoryItem(req.params.item_id, session.user_id);
    res.status(204).send();
  } catch (error) {
    if (error instanceof InventoryNotFoundError) {
      res.status(404).json({ error: 'not_found', message: error.message });
    } else if (error instanceof ForbiddenError) {
      res.status(403).json({ error: 'forbidden', message: error.message });
    } else if (error instanceof Error && error.message.includes('Cannot delete')) {
      res.status(400).json({ error: 'invalid_state', message: error.message });
    } else {
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
inventoryRouter.post('/import', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const { items } = req.body as { items: ImportInventoryItemInput[] };

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

    const result = await importInventoryItems(session.user_id, items);
    res.json(result);
  } catch (error) {
    console.error('[inventory] Import error:', error);
    res.status(500).json({ error: 'internal_error', message: 'Failed to import inventory' });
  }
});

export default inventoryRouter;

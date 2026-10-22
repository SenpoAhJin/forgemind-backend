import { Router, Request, Response, NextFunction } from 'express';
import { requireMarketplaceUser } from '../marketplace/rules';
import { getItemsForUser, createItem } from './inventoryService';

export const inventoryRouter = Router();

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * GET /inventory/mine
 * Returns the caller's owned_attire rows. Never returns another user's items.
 */
inventoryRouter.get(
  '/mine',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;
    const items = await getItemsForUser(caller.user_id);
    res.status(200).json({ items, count: items.length });
  }),
);

/**
 * POST /inventory
 * Creates an owned_attire row for the caller.
 * Accepts: entry_method, auto_categorized_type, flexibility_tag, condition_rating,
 *          original_input_text, notes (all optional; defaults provided).
 */
inventoryRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const caller = await requireMarketplaceUser(req, res);
    if (!caller) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    
    const entry_method = 
      body.entry_method === 'photo' || body.entry_method === 'text' || body.entry_method === 'voice'
        ? body.entry_method
        : 'text';
    
    const auto_categorized_type = typeof body.auto_categorized_type === 'string' 
      ? body.auto_categorized_type.trim() || 'other'
      : 'other';
    
    const flexibility_tag =
      body.flexibility_tag === 'restyle-willing' || 
      body.flexibility_tag === 'dye-willing' || 
      body.flexibility_tag === 'as-is-only'
        ? body.flexibility_tag
        : 'as-is-only';
    
    const condition_rating = 
      typeof body.condition_rating === 'number' && 
      body.condition_rating >= 1 && 
      body.condition_rating <= 5
        ? body.condition_rating
        : 3;
    
    const original_input_text = 
      typeof body.original_input_text === 'string' 
        ? body.original_input_text.trim() || null 
        : null;
    
    const notes = 
      typeof body.notes === 'string' 
        ? body.notes.trim() || null 
        : null;
    
    const item = await createItem(caller.user_id, {
      entry_method,
      auto_categorized_type,
      flexibility_tag,
      condition_rating,
      original_input_text,
      notes,
    });
    
    res.status(201).json({ item });
  }),
);

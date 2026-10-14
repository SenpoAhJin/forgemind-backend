/**
 * AI Attire Matcher Router
 *
 * Proxies attire matching requests to Flask AI service.
 * Transforms mobile OwnedAttire format to Flask format and back.
 */

import { Router, Request, Response } from 'express';
import { requireSession } from '../auth/session';
import { requireMarketplaceUser, isVerifiedMarketplaceUser } from '../marketplace/rules';
import { config } from '../config';

const matcherRouter = Router();

interface OwnedAttire {
  attire_id: string;
  auto_categorized_type: string | null;
  auto_categorized_color: string | null;
  auto_categorized_style: string | null;
  original_input_text: string;
}

interface FlaskOwnedItem {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  color: string;
  tags: string[];
}

interface MatchRequest {
  character_variant_id: string;
  owned_attire: OwnedAttire[];
  user_body_settings?: {
    body_type: 'male' | 'female';
    height: number;
    size: number;
  };
}

interface FlaskMatchResponse {
  character_variant_id: string;
  character_name: string;
  variant_name: string;
  suggested_outfit: Record<string, {
    item_id: string;
    name: string;
    score: number;
    confidence: string;
    breakdown: {
      color: number;
      keywords: number;
      category: number;
    };
  }>;
  alternatives: Record<string, Array<{
    item_id: string;
    name: string;
    score: number;
    confidence: string;
  }>>;
  missing_items: Array<{
    category: string;
    requirements: Record<string, unknown>;
    keywords: string[];
  }>;
  match_quality: {
    overall_score: number;
    quality_label: string;
    completeness?: number;
    average_match_score?: number;
  };
}

/**
 * Transform mobile OwnedAttire to Flask owned_items format
 */
function transformToFlaskFormat(attire: OwnedAttire[]): FlaskOwnedItem[] {
  return attire.map(item => {
    // Extract category and subcategory from auto_categorized_type
    const category = item.auto_categorized_type?.toLowerCase() || 'other';
    
    // Extract tags from style and original text
    const tags: string[] = [];
    if (item.auto_categorized_style) {
      tags.push(item.auto_categorized_style.toLowerCase());
    }
    if (item.auto_categorized_color) {
      tags.push(item.auto_categorized_color.toLowerCase());
    }
    // Add keywords from original text (split and filter)
    if (item.original_input_text) {
      const words = item.original_input_text
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2 && !['the', 'and', 'for', 'with'].includes(w));
      tags.push(...words);
    }

    return {
      id: item.attire_id,
      name: item.original_input_text || 'Unnamed Item',
      category: category,
      subcategory: category,
      color: item.auto_categorized_color || '#808080',
      tags: [...new Set(tags)], // Remove duplicates
    };
  });
}

/**
 * POST /api/ai/match
 * Match user's attire to a character variant
 *
 * Auth: requires verified marketplace user
 *
 * Request body:
 * {
 *   "character_variant_id": "gojo-satoru_season-2-uniform",
 *   "owned_attire": [OwnedAttire[]],
 *   "user_body_settings": { body_type, height, size }
 * }
 *
 * Response: Flask match result (see FlaskMatchResponse interface)
 */
matcherRouter.post('/match', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  const caller = await requireMarketplaceUser(req, res);
  if (!caller) return;

  if (!isVerifiedMarketplaceUser(caller)) {
    res.status(403).json({
      error: 'marketplace_verification_required',
      message: 'Attire matching requires verified marketplace account',
    });
    return;
  }

  try {
    const body = req.body as MatchRequest;

    // Validate required fields
    if (!body.character_variant_id) {
      res.status(400).json({
        error: 'validation_error',
        message: 'character_variant_id is required',
      });
      return;
    }

    if (!Array.isArray(body.owned_attire)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'owned_attire must be an array',
      });
      return;
    }

    // Transform mobile format to Flask format
    const flaskItems = transformToFlaskFormat(body.owned_attire);

    // Build Flask request
    const flaskRequest = {
      character_variant_id: body.character_variant_id,
      owned_items: flaskItems,
      user_body_settings: body.user_body_settings,
    };

    // Call Flask AI service
    const flaskUrl = config.flaskAiUrl || 'http://localhost:5000';
    const response = await fetch(`${flaskUrl}/api/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(flaskRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[matcher] Flask error:', response.status, errorText);
      
      if (response.status === 404) {
        res.status(404).json({
          error: 'character_not_found',
          message: 'Character variant not found in AI database',
        });
        return;
      }

      res.status(502).json({
        error: 'ai_service_error',
        message: 'AI matching service unavailable',
      });
      return;
    }

    const flaskResult = await response.json() as FlaskMatchResponse;

    // Return Flask result directly (mobile can handle the format)
    res.json(flaskResult);

  } catch (err) {
    console.error('[matcher] Unexpected error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to process match request',
    });
  }
});

export default matcherRouter;

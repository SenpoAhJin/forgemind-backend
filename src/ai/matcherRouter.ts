/**
 * AI Attire Matcher Router
 *
 * Proxies attire matching requests to Flask AI service.
 * Transforms mobile OwnedAttire format to Flask format and back.
 */

import { Router, Request, Response } from 'express';
import { requireSession } from '../auth/session';
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

/** Default color fallback for items with no color */
export const DEFAULT_COLOR_FALLBACK = '#808080';

/**
 * Transform mobile OwnedAttire to Flask owned_items format
 */
export function transformToFlaskFormat(attire: OwnedAttire[]): FlaskOwnedItem[] {
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
      color: item.auto_categorized_color || DEFAULT_COLOR_FALLBACK,
      tags: [...new Set(tags)], // Remove duplicates
    };
  });
}

/**
 * Validate character_variant_id and owned_attire request
 * Returns error response or null if valid
 */
export function validateMatchRequest(body: MatchRequest): { status: number; error: string; message: string } | null {
  // Validate character_variant_id
  if (!body.character_variant_id || typeof body.character_variant_id !== 'string') {
    return {
      status: 400,
      error: 'validation_error',
      message: 'character_variant_id is required and must be a string',
    };
  }

  // Validate ID format: lowercase alphanumeric, underscore, hyphen, 1-100 chars
  if (!/^[a-z0-9][a-z0-9_-]{0,100}$/.test(body.character_variant_id)) {
    return {
      status: 400,
      error: 'validation_error',
      message: 'character_variant_id must match ^[a-z0-9][a-z0-9_-]{0,100}$',
    };
  }

  // Validate owned_attire
  if (!Array.isArray(body.owned_attire)) {
    return {
      status: 400,
      error: 'validation_error',
      message: 'owned_attire must be an array',
    };
  }

  if (body.owned_attire.length > 100) {
    return {
      status: 400,
      error: 'validation_error',
      message: 'owned_attire array exceeds maximum length of 100',
    };
  }

  // Validate owned_attire items
  for (const item of body.owned_attire) {
    if (!item.attire_id || typeof item.attire_id !== 'string' || item.attire_id.length > 100) {
      return {
        status: 400,
        error: 'validation_error',
        message: 'Each attire item must have a valid attire_id (string, max 100 chars)',
      };
    }
    if (item.original_input_text && item.original_input_text.length > 500) {
      return {
        status: 400,
        error: 'validation_error',
        message: 'original_input_text exceeds maximum length of 500',
      };
    }
  }

  return null; // Valid
}

/**
 * Map Flask error response to backend error
 */
export function mapFlaskError(statusCode: number): { status: number; error: string; message: string } {
  if (statusCode === 404) {
    return {
      status: 404,
      error: 'character_not_found',
      message: 'Character variant not found in AI database',
    };
  }

  // Any other Flask error -> 502
  return {
    status: 502,
    error: 'ai_service_error',
    message: 'AI matching service returned an error',
  };
}

/**
 * Map Flask fetch error to backend error
 */
export function mapFlaskFetchError(err: Error): { status: number; error: string; message: string } {
  if (err.name === 'AbortError') {
    return {
      status: 503,
      error: 'ai_service_timeout',
      message: 'AI matching service timed out',
    };
  }

  return {
    status: 503,
    error: 'ai_service_unavailable',
    message: 'AI matching service is unreachable',
  };
}

/**
 * POST /api/ai/match
 * Match user's attire to a character variant
 *
 * Auth: requires valid session (not marketplace-specific)
 *
 * Request body:
 * {
 *   "character_variant_id": "gojo-satoru_season-2-uniform",
 *   "owned_attire": [OwnedAttire[]]
 * }
 *
 * Response: Flask match result (see FlaskMatchResponse interface)
 */
matcherRouter.post('/match', async (req: Request, res: Response) => {
  const session = await requireSession(req, res);
  if (!session) return;

  try {
    const body = req.body as MatchRequest;

    // Validate request
    const validationError = validateMatchRequest(body);
    if (validationError) {
      res.status(validationError.status).json({
        error: validationError.error,
        message: validationError.message,
      });
      return;
    }

    // Transform mobile format to Flask format
    const flaskItems = transformToFlaskFormat(body.owned_attire);

    // Build Flask request
    const flaskRequest = {
      character_variant_id: body.character_variant_id,
      owned_items: flaskItems,
    };

    // Call Flask AI service with 8 second timeout
    const flaskUrl = config.flaskAiUrl || 'http://localhost:5000';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(`${flaskUrl}/api/match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(flaskRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[matcher] Flask error:', response.status, errorText);
        
        const errorResponse = mapFlaskError(response.status);
        res.status(errorResponse.status).json({
          error: errorResponse.error,
          message: errorResponse.message,
        });
        return;
      }

      const flaskResult = await response.json() as FlaskMatchResponse;

      // Return Flask result directly (mobile can handle the format)
      res.json(flaskResult);

    } catch (fetchErr) {
      clearTimeout(timeoutId);
      
      const errorResponse = mapFlaskFetchError(fetchErr as Error);
      console.error('[matcher] Flask fetch error:', errorResponse.message);
      res.status(errorResponse.status).json({
        error: errorResponse.error,
        message: errorResponse.message,
      });
      return;
    }

  } catch (err) {
    console.error('[matcher] Unexpected error:', err);
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to process match request',
    });
  }
});

export default matcherRouter;

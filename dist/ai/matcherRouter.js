"use strict";
/**
 * AI Attire Matcher Router
 *
 * Proxies attire matching requests to Flask AI service.
 * Transforms mobile OwnedAttire format to Flask format and back.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COLOR_FALLBACK = void 0;
exports.transformToFlaskFormat = transformToFlaskFormat;
exports.validateMatchRequest = validateMatchRequest;
exports.mapFlaskError = mapFlaskError;
exports.mapFlaskFetchError = mapFlaskFetchError;
const express_1 = require("express");
const session_1 = require("../auth/session");
const config_1 = require("../config");
const colorNames_1 = require("./colorNames");
const slotMapping_1 = require("./slotMapping");
const matcherRouter = (0, express_1.Router)();
/** Default color fallback for items with no color */
exports.DEFAULT_COLOR_FALLBACK = '#808080';
/**
 * Transform mobile OwnedAttire to Flask owned_items format
 */
function transformToFlaskFormat(attire) {
    return attire.map(item => {
        // Map broad type to Flask slot using keywords (RULE-BASED adapter)
        const originalType = item.auto_categorized_type?.toLowerCase() || 'other';
        const flaskSlot = (0, slotMapping_1.mapToFlaskSlot)(item.original_input_text, originalType);
        const subcategory = (0, slotMapping_1.getSubcategory)(item.original_input_text, flaskSlot);
        // Extract tags from style and original text
        const tags = [];
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
        // Convert color name to hex (RULE-BASED adapter)
        const colorHex = (0, colorNames_1.colorNameToHex)(item.auto_categorized_color, exports.DEFAULT_COLOR_FALLBACK);
        return {
            id: item.attire_id,
            name: item.original_input_text || 'Unnamed Item',
            category: flaskSlot,
            subcategory: subcategory,
            color: colorHex,
            tags: [...new Set(tags)], // Remove duplicates
        };
    });
}
/**
 * Validate character_variant_id and owned_attire request
 * Returns error response or null if valid
 */
function validateMatchRequest(body) {
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
function mapFlaskError(statusCode) {
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
function mapFlaskFetchError(err) {
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
matcherRouter.post('/match', async (req, res) => {
    const session = await (0, session_1.requireSession)(req, res);
    if (!session)
        return;
    try {
        const body = req.body;
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
        const flaskUrl = config_1.config.flaskAiUrl || 'http://localhost:5000';
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
            const flaskResult = await response.json();
            // Return Flask result directly (mobile can handle the format)
            res.json(flaskResult);
        }
        catch (fetchErr) {
            clearTimeout(timeoutId);
            const errorResponse = mapFlaskFetchError(fetchErr);
            console.error('[matcher] Flask fetch error:', errorResponse.message);
            res.status(errorResponse.status).json({
                error: errorResponse.error,
                message: errorResponse.message,
            });
            return;
        }
    }
    catch (err) {
        console.error('[matcher] Unexpected error:', err);
        res.status(500).json({
            error: 'internal_error',
            message: 'Failed to process match request',
        });
    }
});
exports.default = matcherRouter;
//# sourceMappingURL=matcherRouter.js.map
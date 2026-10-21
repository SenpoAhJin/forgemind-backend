"use strict";
/**
 * Settings Service
 *
 * Reads configuration from app_settings table with short-lived caching.
 * All trade limits, timeouts, and allowed types come from the database,
 * not from source code. Holder can modify settings via admin API.
 *
 * Cache TTL is itself a setting (settings.cache_seconds), enabling
 * hot-reconfiguration without code changes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSetting = getSetting;
exports.getNumberSetting = getNumberSetting;
exports.getStringSetting = getStringSetting;
exports.getBooleanSetting = getBooleanSetting;
exports.getArraySetting = getArraySetting;
exports.clearCache = clearCache;
exports.updateSetting = updateSetting;
exports.listAllSettings = listAllSettings;
const db_1 = require("../db");
const cache = new Map();
/**
 * Read a setting from the database with short-lived cache.
 * Falls back to seeded default if row is missing (logs warning).
 * Returns the raw JSONB value (caller must parse/cast).
 */
async function getSetting(key) {
    // Check cache
    const cached = cache.get(key);
    if (cached) {
        const cacheTTL = await getCacheTTL();
        const age = Date.now() - cached.cachedAt;
        if (age < cacheTTL) {
            return cached.value;
        }
        // Expired, remove from cache
        cache.delete(key);
    }
    // Fetch from database
    const rows = await (0, db_1.query)(`SELECT key, value, value_type, description, min_value, max_value, version, updated_at
       FROM app_settings
      WHERE key = $1`, [key]);
    if (rows.length === 0) {
        console.warn(`[settingsService] Setting key "${key}" not found in database. Using fallback.`);
        // Return a safe fallback (caller should handle missing keys)
        return null;
    }
    const setting = rows[0];
    // Cache the value
    cache.set(key, {
        value: setting.value,
        cachedAt: Date.now(),
    });
    return setting.value;
}
/**
 * Get cache TTL in milliseconds.
 * Reads settings.cache_seconds from DB (without caching itself to avoid infinite loop).
 * Falls back to 30 seconds if missing.
 */
async function getCacheTTL() {
    const key = 'settings.cache_seconds';
    const rows = await (0, db_1.query)(`SELECT value FROM app_settings WHERE key = $1`, [key]);
    if (rows.length === 0) {
        console.warn(`[settingsService] Cache TTL setting "${key}" not found. Using default 30s.`);
        return 30 * 1000;
    }
    const seconds = Number(rows[0].value);
    if (isNaN(seconds) || seconds <= 0) {
        console.error(`[settingsService] Invalid cache TTL value: ${rows[0].value}. Using default 30s.`);
        return 30 * 1000;
    }
    return seconds * 1000;
}
/**
 * Get a numeric setting. Returns the value as a number.
 * Throws error if value is missing or not numeric (NO fallback).
 */
async function getNumberSetting(key) {
    const raw = await getSetting(key);
    if (raw === null) {
        throw new Error(`Required setting "${key}" not found in app_settings table`);
    }
    const num = Number(raw);
    if (isNaN(num)) {
        throw new Error(`Setting "${key}" value is not a valid number: ${raw}`);
    }
    return num;
}
/**
 * Get a string setting.
 * Throws error if value is missing (NO fallback).
 */
async function getStringSetting(key) {
    const raw = await getSetting(key);
    if (raw === null) {
        throw new Error(`Required setting "${key}" not found in app_settings table`);
    }
    return String(raw);
}
/**
 * Get a boolean setting.
 * Throws error if value is missing (NO fallback).
 */
async function getBooleanSetting(key) {
    const raw = await getSetting(key);
    if (raw === null) {
        throw new Error(`Required setting "${key}" not found in app_settings table`);
    }
    return Boolean(raw);
}
/**
 * Get an array setting (JSONB array).
 * Throws error if missing or not an array (NO fallback).
 */
async function getArraySetting(key) {
    const raw = await getSetting(key);
    if (raw === null) {
        throw new Error(`Required setting "${key}" not found in app_settings table`);
    }
    if (!Array.isArray(raw)) {
        throw new Error(`Setting "${key}" is not an array`);
    }
    return raw;
}
/**
 * Clear the entire cache (for testing or after admin updates).
 * In production, cache naturally expires after settings.cache_seconds.
 */
function clearCache() {
    cache.clear();
}
/**
 * Update a setting (for admin endpoints).
 * Validates min/max bounds for numeric settings.
 * Increments version, sets updated_by, clears cache entry.
 */
async function updateSetting(key, newValue, updatedBy) {
    // Fetch current setting to check type and bounds
    const rows = await (0, db_1.query)(`SELECT key, value_type, min_value, max_value FROM app_settings WHERE key = $1`, [key]);
    if (rows.length === 0) {
        return { success: false, error: 'Setting not found' };
    }
    const setting = rows[0];
    // Type validation
    const actualType = typeof newValue;
    let typeMatch = false;
    switch (setting.value_type) {
        case 'number':
            typeMatch = actualType === 'number' || actualType === 'string'; // String OK if parseable
            break;
        case 'string':
            typeMatch = actualType === 'string';
            break;
        case 'boolean':
            typeMatch = actualType === 'boolean';
            break;
        case 'array':
            typeMatch = Array.isArray(newValue);
            break;
        case 'object':
            typeMatch = actualType === 'object' && !Array.isArray(newValue);
            break;
    }
    if (!typeMatch) {
        return { success: false, error: `Value must be of type ${setting.value_type}` };
    }
    // Numeric bounds validation
    if (setting.value_type === 'number') {
        const num = Number(newValue);
        if (isNaN(num)) {
            return { success: false, error: 'Value is not a valid number' };
        }
        if (setting.min_value !== null && num < setting.min_value) {
            return { success: false, error: `Value must be >= ${setting.min_value}` };
        }
        if (setting.max_value !== null && num > setting.max_value) {
            return { success: false, error: `Value must be <= ${setting.max_value}` };
        }
    }
    // Update the setting
    await (0, db_1.query)(`UPDATE app_settings
        SET value = $1,
            version = version + 1,
            updated_by = $2,
            updated_at = NOW()
      WHERE key = $3`, [JSON.stringify(newValue), updatedBy, key]);
    // Clear cache entry
    cache.delete(key);
    return { success: true };
}
/**
 * List all settings (for admin UI).
 */
async function listAllSettings() {
    const rows = await (0, db_1.query)(`SELECT key, value, value_type, description, min_value, max_value, version, updated_at
       FROM app_settings
      ORDER BY key ASC`);
    return rows;
}
//# sourceMappingURL=settingsService.js.map
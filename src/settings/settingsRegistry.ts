/**
 * Settings Registry - Required Trade Settings
 *
 * Single source of truth for all required app_settings keys.
 * Enforced at server startup - missing keys cause immediate failure.
 *
 * NO fallback defaults in code. Migration seeds are the only source of defaults.
 */

export interface SettingDefinition {
  key: string;
  valueType: 'number' | 'string' | 'boolean' | 'array' | 'object';
  minValue?: number;
  maxValue?: number;
  description: string;
}

/**
 * All required trade settings.
 * If any key is missing from app_settings table, server startup FAILS.
 */
export const REQUIRED_TRADE_SETTINGS: SettingDefinition[] = [
  {
    key: 'trade.offer_expiry_hours',
    valueType: 'number',
    minValue: 1,
    maxValue: 720,
    description: 'Hours before a proposed trade expires if not accepted',
  },
  {
    key: 'trade.confirm_window_hours',
    valueType: 'number',
    minValue: 1,
    maxValue: 168,
    description: 'Hours after acceptance for both parties to confirm physical handoff',
  },
  {
    key: 'trade.max_items_per_side',
    valueType: 'number',
    minValue: 1,
    maxValue: 20,
    description: 'Maximum items one party can offer in a single trade',
  },
  {
    key: 'trade.max_active_trades_per_user',
    valueType: 'number',
    minValue: 1,
    maxValue: 50,
    description: 'Maximum concurrent active trades (proposed or accepted) per user',
  },
  {
    key: 'trade.allowed_types',
    valueType: 'array',
    description: 'Trade types permitted on the platform (JSON array of strings)',
  },
  {
    key: 'trade.reminder_hours_before_expiry',
    valueType: 'number',
    minValue: 1,
    maxValue: 72,
    description: 'Hours before expiry to send reminder notifications',
  },
  {
    key: 'trade.expiry_sweep_minutes',
    valueType: 'number',
    minValue: 1,
    maxValue: 60,
    description: 'Interval in minutes for system to check and expire stale trades',
  },
  {
    key: 'settings.cache_seconds',
    valueType: 'number',
    minValue: 5,
    maxValue: 600,
    description: 'TTL in seconds for settings cache (controls how fast changes propagate)',
  },
];

/**
 * Verify all required settings exist in the database.
 * Called at server startup. Fails fast if any keys are missing.
 *
 * @throws Error listing all missing keys
 */
export async function verifyRequiredSettings(
  querFn: (sql: string, params?: unknown[]) => Promise<{ key: string }[]>
): Promise<void> {
  const keys = REQUIRED_TRADE_SETTINGS.map(s => s.key);
  
  const rows = await querFn(
    `SELECT key FROM app_settings WHERE key = ANY($1::text[])`,
    [keys]
  );
  
  const foundKeys = new Set(rows.map(r => r.key));
  const missingKeys = keys.filter(k => !foundKeys.has(k));
  
  if (missingKeys.length > 0) {
    throw new Error(
      `FATAL: Missing required settings in app_settings table:\n` +
      missingKeys.map(k => `  - ${k}`).join('\n') +
      `\n\nRun migration 021 to seed default values.`
    );
  }
  
  console.log(`[settings] ✓ All ${keys.length} required settings present`);
}

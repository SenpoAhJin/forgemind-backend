/**
 * Marketplace numeric limits and constraints.
 *
 * Centralized constants for price, rate, budget and other numeric validations.
 */

/** Maximum amount in PHP for any marketplace money field. */
export const MAX_AMOUNT_PHP = 200000;

/** Threshold above which a price is flagged as a potential outlier (no block). */
export const PRICE_OUTLIER_PHP = 30000;

/** Maximum decimal places for money amounts. */
export const MAX_DECIMALS = 2;

"use strict";
/**
 * Marketplace numeric limits and constraints.
 *
 * Centralized constants for price, rate, budget and other numeric validations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DECIMALS = exports.PRICE_OUTLIER_PHP = exports.MAX_AMOUNT_PHP = void 0;
/** Maximum amount in PHP for any marketplace money field. */
exports.MAX_AMOUNT_PHP = 200000;
/** Threshold above which a price is flagged as a potential outlier (no block). */
exports.PRICE_OUTLIER_PHP = 30000;
/** Maximum decimal places for money amounts. */
exports.MAX_DECIMALS = 2;
//# sourceMappingURL=limits.js.map
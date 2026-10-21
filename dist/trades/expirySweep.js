"use strict";
/**
 * Trade Expiry Sweep
 *
 * Background interval that expires stale proposed/accepted trades.
 * Re-reads sweep interval each cycle (hot-reconfiguration).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startExpirySweep = startExpirySweep;
exports.stopExpirySweep = stopExpirySweep;
const tradeService_1 = require("./tradeService");
const settingsService_1 = require("../settings/settingsService");
let intervalId = null;
let isRunning = false;
/**
 * Start the expiry sweep interval.
 * Re-reads trade.expiry_sweep_minutes setting each cycle.
 * Crashes in one sweep do NOT stop the interval.
 */
function startExpirySweep() {
    if (isRunning) {
        console.warn('[expiry-sweep] Already running, ignoring duplicate start');
        return;
    }
    isRunning = true;
    // Run first sweep immediately (async, don't await)
    runSweep();
    // Schedule recurring sweeps
    scheduleNext();
}
/**
 * Stop the expiry sweep interval.
 */
function stopExpirySweep() {
    if (intervalId) {
        clearTimeout(intervalId);
        intervalId = null;
    }
    isRunning = false;
    console.log('[expiry-sweep] Stopped');
}
/**
 * Schedule the next sweep after reading the interval setting.
 */
function scheduleNext() {
    if (!isRunning)
        return;
    (0, settingsService_1.getNumberSetting)('trade.expiry_sweep_minutes')
        .then((minutes) => {
        const ms = minutes * 60 * 1000;
        intervalId = setTimeout(() => {
            runSweep();
            scheduleNext(); // Schedule next after this one completes
        }, ms);
    })
        .catch((err) => {
        console.error('[expiry-sweep] Failed to read sweep interval setting:', err);
        // Retry after 5 minutes
        intervalId = setTimeout(() => {
            runSweep();
            scheduleNext();
        }, 5 * 60 * 1000);
    });
}
/**
 * Run one sweep cycle.
 * Logs count only (no trade IDs or user data).
 * Errors are caught and logged (do NOT crash the server).
 */
async function runSweep() {
    try {
        const count = await (0, tradeService_1.expireStaleTrades)();
        if (count > 0) {
            console.log(`[expiry-sweep] Expired ${count} stale trade(s)`);
        }
    }
    catch (err) {
        console.error('[expiry-sweep] Error during sweep:', err instanceof Error ? err.message : String(err));
        // Do NOT throw - next sweep will try again
    }
}
//# sourceMappingURL=expirySweep.js.map
"use strict";
/**
 * Listing quality check - plausibility gate before moderation.
 *
 * Rejects gibberish and non-text listings that would waste moderation cycles.
 * A listing with implausible tokens (keyboard mash, repeated characters, no vowels)
 * in the title or description fails before it reaches moderation or storage.
 *
 * NO MINIMUM LENGTH: a title like "Wig" must pass.
 * Tagalog words with consonant clusters (ng, mga, nasa, ginawa) must not be flagged.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.QUALITY_MESSAGE = void 0;
exports.checkListingQuality = checkListingQuality;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Load trigram model
const trigramPath = path.join(__dirname, 'data/char_ngrams.json');
const TRIGRAM_PROBS = fs.existsSync(trigramPath)
    ? JSON.parse(fs.readFileSync(trigramPath, 'utf-8'))
    : {};
// Tuned threshold for average log probability per character
// A token with average log-prob below this is implausible
// Tuned to keep false reject rate on clean data under 1%
const LOG_PROB_THRESHOLD = -12.0; // Relaxed from -8.5
// Implausible token rate threshold
// Text fails when this fraction or more of tokens are implausible
const IMPLAUSIBLE_RATE_THRESHOLD = 0.70; // Raised from 0.60 to reduce false rejects
exports.QUALITY_MESSAGE = 'Please use a real item name and describe the item in a few words';
/**
 * Checks listing text quality.
 *
 * Returns ok=false when the text appears to be gibberish or non-text.
 */
function checkListingQuality(fields) {
    const issues = [];
    // Check title
    const titleCheck = checkTextQuality(fields.title);
    if (!titleCheck.ok) {
        issues.push({ field: 'title', code: titleCheck.code });
    }
    // Check description
    const descCheck = checkTextQuality(fields.description);
    if (!descCheck.ok) {
        issues.push({ field: 'description', code: descCheck.code });
    }
    // Check trade items if present
    if (fields.trade_offered_item) {
        const offeredCheck = checkTextQuality(fields.trade_offered_item);
        if (!offeredCheck.ok) {
            issues.push({ field: 'trade_offered_item', code: offeredCheck.code });
        }
    }
    if (fields.trade_wanted_item) {
        const wantedCheck = checkTextQuality(fields.trade_wanted_item);
        if (!wantedCheck.ok) {
            issues.push({ field: 'trade_wanted_item', code: wantedCheck.code });
        }
    }
    return { ok: issues.length === 0, issues };
}
/**
 * Checks if text appears to be real words vs gibberish.
 */
function checkTextQuality(text) {
    const normalized = text.toLowerCase();
    // Extract letter-only tokens
    const tokens = normalized.match(/[a-z]+/g) || [];
    // No letters at all (only numbers, symbols, emoji)
    if (tokens.length === 0) {
        return { ok: false, code: 'no_letters' };
    }
    // Filter tokens: skip 1-2 letter tokens and tokens containing digits
    const checkableTokens = tokens.filter(t => t.length >= 3);
    if (checkableTokens.length === 0) {
        // All tokens were too short, but there were letters - accept it
        return { ok: true };
    }
    // Count implausible tokens
    let implausible = 0;
    for (const token of checkableTokens) {
        if (isImplausible(token)) {
            implausible++;
        }
    }
    // Fail when 70% or more of checkable tokens are implausible
    const implausibleRate = implausible / checkableTokens.length;
    if (implausibleRate >= IMPLAUSIBLE_RATE_THRESHOLD) {
        return { ok: false, code: 'implausible_tokens' };
    }
    return { ok: true };
}
/**
 * True when a token appears to be gibberish.
 *
 * A token is implausible when it:
 * - Has no vowels and 4+ letters
 * - Has the same character 4+ times in a row
 * - Has a long consonant run (5+ consonants without a vowel)
 * - Has low average trigram log-probability per character
 */
function isImplausible(token) {
    const vowels = 'aeiou';
    // No vowels and 4+ letters
    if (token.length >= 4 && !Array.from(token).some(c => vowels.includes(c))) {
        // Exception: common Tagalog consonant clusters
        if (!isTagalogConsonantCluster(token)) {
            return true;
        }
    }
    // Same character 4+ times in a row
    if (/(.)\1{3,}/.test(token)) {
        return true;
    }
    // Long consonant run: 5+ consonants without a vowel
    const consonantRun = token.match(/[^aeiou]+/g) || [];
    if (consonantRun.some(run => run.length >= 5)) {
        // Exception for Tagalog patterns
        if (!consonantRun.some(run => containsTagalogPattern(run))) {
            return true;
        }
    }
    // Trigram probability check
    if (token.length >= 3) {
        const avgLogProb = calculateAvgLogProb(token);
        if (avgLogProb < LOG_PROB_THRESHOLD) {
            return true;
        }
    }
    return false;
}
/**
 * Calculate average log probability per character using trigrams.
 */
function calculateAvgLogProb(token) {
    if (token.length < 3)
        return 0;
    let totalLogProb = 0;
    let count = 0;
    for (let i = 0; i < token.length - 2; i++) {
        const trigram = token.substring(i, i + 3);
        const logProb = TRIGRAM_PROBS[trigram] ?? -15; // Unknown trigrams get very low prob
        totalLogProb += logProb;
        count++;
    }
    return totalLogProb / count;
}
/**
 * True for common Tagalog consonant cluster patterns.
 */
function isTagalogConsonantCluster(token) {
    // Common Tagalog patterns: ng, mga, nasa, ginawa, etc.
    const tagalogPatterns = ['ng', 'mga', 'ngg', 'ngm'];
    return tagalogPatterns.some(pattern => token.includes(pattern));
}
/**
 * True when consonant run contains Tagalog patterns.
 */
function containsTagalogPattern(run) {
    return run.includes('ng') || run.includes('mg');
}
//# sourceMappingURL=quality.js.map
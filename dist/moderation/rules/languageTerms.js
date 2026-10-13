"use strict";
/**
 * The per-language blocked-term lists, loaded from data instead of hand-written.
 *
 * WHY TWO FILES
 * blocked_terms_en.json is mined from the English side of the corpus;
 * blocked_terms_tl.json carries the hand-written Tagalog and Taglish vocabulary
 * plus whatever the Tagalog side of the corpus supports. The split is a
 * provenance and review boundary, not a runtime one: BOTH files are loaded and
 * BOTH are matched against every listing. A Taglish listing is checked by both,
 * and a language detector is never asked to decide whether a listing may post.
 * A wrong guess there would be a silent bypass, so the detector only ever chooses
 * which file a mined term is filed under, long before any listing exists.
 *
 * WHY THE TERMS ARE FED TO THE EXISTING MATCHER
 * Nothing here matches anything. Every term goes through `compileWord`, the same
 * normalizer the curated lists use, so case folding, homoglyph folding, symbol
 * and number mapping, separator handling and repeated-letter collapsing all
 * apply to a generated term exactly as they apply to a reviewed one. The lookup
 * is `indexMatches`, which keeps whole-word matching for single words and
 * word-aligned contiguous phrases for multi-word terms. A generated term
 * therefore cannot be a bare substring hit, which is the failure mode that would
 * let an innocent listing get blocked over the letters inside an ordinary word.
 *
 * WHY EACH TERM KEEPS ITS CLASS
 * The miner records which class of non-clean row supplied each term, and that
 * class decides which existing ViolationCode the listing reports. A term mined
 * from hateful rows reports HATE, one mined from vulgar rows reports VULGAR, and
 * anything else reports the generic BLOCKED_TERM. The seller therefore reads the
 * same message they would have read for the hand-written list, and no new
 * violation code is invented.
 *
 * THE CLEAN-WORD ALLOWLIST
 * Each file carries the words that were most frequent in clean rows. It is
 * applied exactly like the curated allowlist: a hit is rescued when the field
 * also contains a strictly longer allowlisted word that contains the hit. Terms
 * were already selected for never appearing in a clean row at all, so this is a
 * second, independent guard rather than the only one.
 *
 * A MISSING OR EMPTY FILE IS NOT A CRASH
 * The screener has to keep working if the generated data is absent, so an empty
 * file yields an empty index and the curated rules carry on alone.
 *
 * THE FILES ARE NEVER SERVED
 * Only counts and class names leave this module. The terms themselves are used
 * for matching and for offline measurement, never returned from an endpoint.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.languageTermIndex = languageTermIndex;
exports.languageAllowlist = languageAllowlist;
exports.languageTermCode = languageTermCode;
exports.languageTermCount = languageTermCount;
exports.languageTermDroppedCount = languageTermDroppedCount;
exports.languageTermCountByLanguage = languageTermCountByLanguage;
exports.languageTermCountByCode = languageTermCountByCode;
exports.languageAllowlistCount = languageAllowlistCount;
exports.languageTermSchemaVersion = languageTermSchemaVersion;
exports.languageTermMatches = languageTermMatches;
exports.resetLanguageTermCache = resetLanguageTermCache;
const normalize_1 = require("../normalize");
const blocked_terms_en_json_1 = __importDefault(require("../data/blocked_terms_en.json"));
const blocked_terms_tl_json_1 = __importDefault(require("../data/blocked_terms_tl.json"));
/**
 * Class name in the file -> the violation code the listing reports.
 *
 * Every class the miner can write is listed, so a new class cannot silently
 * fall through to a code nobody chose. `blocked` is the label used for rows the
 * corpus marked blocked without a finer class.
 */
const CLASS_TO_CODE = {
    adult: 'ADULT',
    vulgar: 'VULGAR',
    hate: 'HATE',
    prohibited: 'PROHIBITED_ITEM',
    unrelated: 'UNRELATED',
    blocked: 'BLOCKED_TERM',
    other: 'BLOCKED_TERM',
};
/** Fallback when a file row carries no class the mapping knows. */
const DEFAULT_CODE = 'BLOCKED_TERM';
let cached = null;
function rowsOf(data) {
    const parsed = (data ?? {});
    return { rows: Array.isArray(parsed.terms) ? parsed.terms : [], meta: parsed };
}
function load() {
    if (cached)
        return cached;
    const terms = [];
    const code = new Map();
    const language = new Map();
    const allow = [];
    const countByLanguage = {};
    const countByCode = {};
    const seenAllow = new Set();
    let dropped = 0;
    let schemaVersion = 0;
    for (const data of [blocked_terms_en_json_1.default, blocked_terms_tl_json_1.default]) {
        const { rows, meta } = rowsOf(data);
        const label = typeof meta.language === 'string' && meta.language !== '' ? meta.language : 'unknown';
        schemaVersion = Math.max(schemaVersion, typeof meta.schema_version === 'number' ? meta.schema_version : 0);
        for (const row of rows) {
            if (typeof row?.term !== 'string' || row.term.trim() === '') {
                dropped += 1;
                continue;
            }
            const compiled = (0, normalize_1.compileWord)(row.term);
            if (compiled.spaced === '') {
                dropped += 1;
                continue;
            }
            const mapped = CLASS_TO_CODE[String(row.class ?? '')] ?? DEFAULT_CODE;
            terms.push(compiled);
            code.set(compiled.spaced, mapped);
            language.set(compiled.spaced, label);
            countByLanguage[label] = (countByLanguage[label] ?? 0) + 1;
            countByCode[mapped] = (countByCode[mapped] ?? 0) + 1;
        }
        for (const word of meta.allowlist ?? []) {
            if (typeof word !== 'string' || word.trim() === '')
                continue;
            const compiled = (0, normalize_1.compileWord)(word);
            if (compiled.spaced === '' || seenAllow.has(compiled.spaced))
                continue;
            seenAllow.add(compiled.spaced);
            allow.push(compiled);
        }
    }
    cached = {
        terms,
        index: (0, normalize_1.buildTermIndex)(terms),
        code,
        language,
        allow,
        count: terms.length,
        dropped,
        countByLanguage,
        countByCode,
        allowlistCount: allow.length,
        schemaVersion,
    };
    return cached;
}
/** The fast lookup shape over both language files. Built once, on first use. */
function languageTermIndex() {
    return load().index;
}
/** The clean-word allowlist shared by both files. */
function languageAllowlist() {
    return load().allow;
}
/**
 * The code a hit should report, or undefined when the term is unknown.
 *
 * Undefined means the hit did not come from these files, which keeps a caller
 * from inventing a code for a term it did not load.
 */
function languageTermCode(spacedTerm) {
    return load().code.get(spacedTerm);
}
/** Usable terms across both files. The number tests and reports quote. */
function languageTermCount() {
    return load().count;
}
/** Rows the files held that cannot be matched, so the reported size stays honest. */
function languageTermDroppedCount() {
    return load().dropped;
}
/** Usable terms per file. Keys are file language labels, never terms. */
function languageTermCountByLanguage() {
    return load().countByLanguage;
}
/** Usable terms per reported code. Keys are ViolationCodes, never terms. */
function languageTermCountByCode() {
    return load().countByCode;
}
/** Size of the clean-word allowlist. */
function languageAllowlistCount() {
    return load().allowlistCount;
}
/** Schema version of the generated files, or 0 when it predates versioning. */
function languageTermSchemaVersion() {
    return load().schemaVersion;
}
/**
 * Every loaded term that appears in `target`, each one reported once.
 *
 * Returned for offline measurement and for resolving the reported code. Nothing
 * on a request path may put one into a response, a log line or an error message:
 * a caller that can read back the matched term can rebuild the whole list one
 * listing at a time.
 */
function languageTermMatches(target) {
    const loaded = load();
    if (loaded.terms.length === 0)
        return [];
    return (0, normalize_1.indexMatches)(target, loaded.index);
}
/** Drops the memoized lists. Only used by tests that need a cold build. */
function resetLanguageTermCache() {
    cached = null;
}
//# sourceMappingURL=languageTerms.js.map
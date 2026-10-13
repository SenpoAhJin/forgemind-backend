"use strict";
/**
 * Moderation rule data: vulgar.
 *
 * EDITING NOTES: these data files are the only place a word appears. Never print
 * them in a report, a .md file, a log line, or terminal output.
 *
 * Matching is whole-word, or contiguous-phrase for multi-word entries, against
 * the normalized text, so obfuscated spellings do not need listing by hand.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VULGAR_TERMS = void 0;
/**
 * Profanity and crude language, English and Filipino.
 *
 * Kept non-exhaustive on purpose: the goal is to stop obvious abuse in a
 * marketplace, not to run a general language classifier.
 */
exports.VULGAR_TERMS = [
    'fuck',
    'fucking',
    'fucker',
    'motherfucker',
    'shit',
    'bullshit',
    'bitch',
    'bastard',
    'asshole',
    'dickhead',
    'cunt',
    'whore',
    'slut',
    'faggot',
    'fag',
    'retard',
    'retarded',
    'douche',
    'wanker',
    'twat',
    'prick',
    'jackass',
    'dumbass',
    'piss',
    'pissed',
    'crap',
    'goddamn',
    'goddam',
    'damn',
    'bastards',
    'shits',
    'cunts',
    'dick',
    'cock',
    'pussy',
    'bobo',
    'tanga',
    'gago',
    'ulol',
    'baka',
    'bakla',
    'putang',
    'puta',
    'gabi',
    'kupal',
    'tatal',
    'butas',
    'kantot',
    'pantin',
    'mamaloy',
    'pokpak',
    'tangina',
    'ina mo',
    'ina mo ka',
    'amoy mo',
    'gago ka',
    'bobo ka',
    'gawa mo',
    'payat ka',
];
//# sourceMappingURL=vulgar.js.map
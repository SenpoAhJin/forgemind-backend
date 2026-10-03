/**
 * Moderation rule data: hate.
 *
 * EDITING NOTES: these data files are the only place a word appears. Never print
 * them in a report, a .md file, a log line, or terminal output.
 *
 * Matching is whole-word, or contiguous-phrase for multi-word entries, against
 * the normalized text, so obfuscated spellings do not need listing by hand.
 */

/**
 * Slurs and dehumanizing terms aimed at a protected group.
 *
 * Includes one ethnic slur common in Philippine listings. It is stored
 * readable because matching requires it, which is exactly why these files are
 * never printed, logged, or committed to a report.
 */
export const HATE_TERMS: readonly string[] = [
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'tranny',
  'retard',
  'retarded',
  'spic',
  'wetback',
  'chink',
  'gook',
  'kike',
  'coon',
  'jap',
  'wogs',
  'gypo',
  'morons',
  'idiots',
  'putanginamo',
];

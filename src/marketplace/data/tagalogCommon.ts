/**
 * A set of ordinary Tagalog and Taglish words that the plausibility model must
 * never call implausible.
 *
 * WHY THIS FILE EXISTS
 * The character-trigram model in src/marketplace/data/char_ngrams.json is
 * trained on the project's own labelled rows, and those rows are overwhelmingly
 * English: Tagalog and Taglish rows together are a small fraction of the
 * training text. A model trained that way still knows the shape of Tagalog
 * letters, because the alphabet is shared, but it has very little Tagalog to
 * lean on, so a real Tagalog title can land below a probability threshold that
 * English text clears comfortably. Refusing a real Tagalog listing is the worst
 * outcome this check can produce: it takes a seller's income away over wording
 * rather than over safety.
 *
 * These are the high-frequency Tagalog words a listing is built from: function
 * words, pronouns, common verbs, common nouns, and the particles and affixes
 * that make Tagalog and Taglish sound the way they do. A token in this list is
 * treated as plausible regardless of its trigram score.
 *
 * This is not a moderation list. Nothing here blocks anything. A word appearing
 * in this file says only that the text reads as real Tagalog, never that it is
 * acceptable to sell. Ordinary vocabulary only: nothing offensive, sexual,
 * weapon or drug related belongs here, and none of it does.
 */
export interface CommonTokenFile {
  schema_version: number;
  note: string;
  count: number;
  tokens: string[];
}

export const TAGALOG_COMMON: readonly string[] = [
  // particles and connectives
  'ang', 'ng', 'mga', 'si', 'ni', 'at', 'o', 'pero', 'kung', 'kapag',
  'habang', 'bago', 'pagkatapos', 'bakit', 'ano', 'sino', 'saan', 'ilan', 'kano',
  'paano', 'sa', 'saan', 'kita', 'natin', 'ninyo', 'nila', 'akin', 'iyo', 'ila',
  // pronouns and possessive forms
  'ako', 'ikaw', 'kami', 'tayo', 'sila', 'ito', 'iyon', 'iyan', 'iyong', 'siya',
  'akin', 'iyo', 'kanila', 'ating', 'inyong', 'sarili', 'kanila', 'inyo',
  // negations and affirmations
  'hindi', 'wala', 'may', 'meron', 'oo', 'opo', 'ay', 'yung', 'doon',
  'dito', 'roon', 'kanino', 'kayo',
  // common verbs
  'ginawang', 'ginawa', 'ginagawa', 'gawin', 'gagawin', 'bibili', 'binibili',
  'ibinebenta', 'ibibenta', 'nabili', 'kailangan', 'pwede', 'puwede', 'puwde',
  'gusto', 'ayaw', 'maaari', 'mukhang', 'narito', 'pumunta', 'pupunta', 'galing',
  'mula', 'kumuha', 'nagsimula', 'sinimulan', 'ginawan', 'naayos', 'inayos',
  'pinalitan', 'ginalitan', 'idagdag', 'inaalis', 'ipinadala', 'papadala',
  // descriptive words a seller uses
  'maganda', 'mabuti', 'mataas', 'mababa', 'malaki', 'maliit', 'mahusay',
  'ganda', 'napaka', 'sobrang', 'murang', 'mataas', 'bago', 'luma',
  'higit', 'kulang', 'sapat', 'tama', 'mali', 'gumawa', 'sinagawa',
  // trade, offer and transaction words
  'alok', 'offer', 'kinukusa', 'palitan', 'mapapalitan', 'ibabalit', 'gusto',
  'gustong', 'nais', 'ayong',
  // time and quantity
  'araw', 'arawan', 'gabi', 'umaga', 'hapon', 'linggo', 'buwan', 'taon',
  'oras', 'marami', 'ilan', 'limang', 'tatlo', 'dalawa', 'isa',
  // places and common proper-noun shaped words
  'pilipinas', 'manila', 'cebu', 'davao', 'quezon', 'luzon', 'mindanao',
  'visayas', 'metro', 'pilipino', 'filipino', 'tagalog', 'tagalog',
  // common english borrowings that appear inside taglish
  'item', 'items', 'price', 'listing', 'brand', 'size', 'fit', 'set', 'kit',
  'free', 'shipping', 'meet', 'ups', 'cod', 'gcash', 'maya', 'yung', 'yung',
];

export const TAGALOG_COMMON_SET: ReadonlySet<string> = new Set(TAGALOG_COMMON);
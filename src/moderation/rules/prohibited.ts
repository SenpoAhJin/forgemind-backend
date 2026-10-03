/**
 * Moderation rule data: prohibited.
 *
 * EDITING NOTES: these data files are the only place a word appears. Never print
 * them in a report, a .md file, a log line, or terminal output.
 *
 * Matching is whole-word, or contiguous-phrase for multi-word entries, against
 * the normalized text, so obfuscated spellings do not need listing by hand.
 */

/**
 * Goods that cannot be sold here regardless of cosplay framing: real weapons,
 * ammunition, explosives, drugs, counterfeit documents, stolen goods.
 */
export const PROHIBITED_ITEM_TERMS: readonly string[] = [
  'firearm',
  'handgun',
  'revolver',
  'pistol',
  'rifle',
  'shotgun',
  'submachine gun',
  'assault rifle',
  'machine gun',
  'sniper rifle',
  'ammunition',
  'ammo',
  'bullet',
  'live round',
  'silencer',
  'suppressor',
  'explosive',
  'explosives',
  'bomb',
  'grenade',
  'ied',
  'detonator',
  'dynamite',
  'napalm',
  'thermite',
  'blasting cap',
  'pipe bomb',
  'firecracker',
  'heroin',
  'cocaine',
  'methamphetamine',
  'meth',
  'ecstasy',
  'mdma',
  'lsd',
  'fentanyl',
  'ketamine',
  'cannabis',
  'marijuana',
  'weed',
  'drug',
  'drugs',
  'narcotic',
  'narcotics',
  'opioid',
  'narcotics parcel',
  'counterfeit id',
  'fake id',
  'fake passport',
  'forged passport',
  'counterfeit passport',
  'fake diploma',
  'fake certificate',
  'forged signature',
  'counterfeit money',
  'fake money',
  'counterfeit bill',
  'phishing page',
  'stolen goods',
  'stolen phone',
  'hot merchandise',
  'shoplifted',
];

/**
 * Words that make an otherwise prohibited term legitimate, because the seller is
 * describing a replica, a toy, or a foam build rather than the real thing.
 *
 * Every entry must survive normalization as a real word or a real phrase. An
 * entry that folds down to one or two characters stops being a qualifier and
 * starts excusing unrelated listings, so those are not allowed here.
 */
export const PROHIBITED_CONTEXT: readonly string[] = [
  'prop',
  'replica',
  'reproduction',
  'foam',
  'eva',
  'eva foam',
  'cosplay',
  'toy',
  'larp',
  'airsoft',
  'cosplay prop',
  'screen accurate',
  'non functional',
  'nonfunctional',
  'decorative',
  'fictional',
  'movie',
  'costume',
  'cardboard',
  'papercraft',
  'resin',
  '3d printed',
  '3d print',
  'plush',
  'lego',
  'minifig',
  'statue',
  'figurine',
  'model kit',
  'soft air',
  'blank firing',
  'theatrical',
  'stage',
  'prop weapon',
  'cosplay weapon',
  'foam sword',
  'foam blade',
  'nunchaku cosplay',
];

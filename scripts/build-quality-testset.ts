/**
 * Builds data/quality_testset.json: the fixed set the plausibility thresholds
 * are measured against.
 *
 * WHY A SEPARATE FILE
 * The labelled dataset is what the model is trained on, so measuring on it
 * would be measuring the model against itself. This file is the held-out view,
 * and it is written down rather than generated at measure time so that a change
 * to the thresholds can be compared against exactly the same texts.
 *
 * WHAT IS IN IT
 * 40 or more real listing texts that must pass, spread across English, Tagalog
 * and Taglish, including the cases a length rule would break: one-word titles,
 * character names, model numbers, brand names and made-to-order commissions.
 * 40 or more nonsense texts that must fail, in four flavours: keyboard mash,
 * repeated letters, random letter strings, and nonsense with a few real words
 * mixed in. The last flavour is the important one, because it is the case a
 * token-level rule passes and a share-of-tokens rule catches.
 *
 * NOTHING SENSITIVE IS WRITTEN HERE
 * The real texts are ordinary cosplay listings. The nonsense texts are
 * generated letter sequences, not anything a person would type about a
 * prohibited item.
 *
 * Run with: npx tsx scripts/build-quality-testset.ts
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/quality_testset.json');

// ---------------------------------------------------------------------------
// Real texts that must pass.
// ---------------------------------------------------------------------------

const REAL: { language: string; title: string; description: string }[] = [
  { language: 'en', title: 'Wig', description: 'Short bob wig, black, fits most heads.' },
  { language: 'en', title: 'Prop', description: 'Foam sword prop for my convention costume.' },
  { language: 'en', title: 'Boots', description: 'Black platform boots, size 7, lightly worn.' },
  { language: 'en', title: 'Cape', description: 'Satin cape with a stand collar, made last month.' },
  { language: 'en', title: 'Nezuko Cosplay', description: 'Full Nezuko costume from Demon Slayer, fitted to my measurements.' },
  { language: 'en', title: 'Sailor Moon Cosplay', description: 'Complete Sailor Moon set, skirt and bodice, worn twice.' },
  { language: 'en', title: 'Howl Moving Castle Cosplay', description: 'Howl costume with the cape and the hat, sewn by me.' },
  { language: 'en', title: 'RX-78-2 Plush', description: 'Handmade RX-78-2 Gundam plush, about 20 cm tall.' },
  { language: 'en', title: 'ZZ-9 Ver. Ka Cosplay', description: 'ZZ-9 Ver. Ka costume set, shoulder armour included.' },
  { language: 'en', title: 'Bear Cubset', description: 'Character costume for a kawaii bear theme group.' },
  { language: 'en', title: 'Compression Spider-Man Suit', description: 'Compression suit in red and blue, size medium, made to order.' },
  { language: 'en', title: 'Ghost Face Mask', description: 'Halloween mask, brand new, never worn, size adjustable.' },
  { language: 'en', title: 'Punk Wig', description: 'Short spiky punk wig, synthetic fibre, colour is dark green.' },
  { language: 'en', title: 'Long Purple Wig', description: 'Cosplay wig, long and purple, heat resistant fibre.' },
  { language: 'en', title: 'Tail', description: 'Animal tail accessory, plush, fits at the waist with an elastic belt.' },
  { language: 'en', title: 'Embroidered Patch', description: 'Hand embroidered character patch, about 8 cm wide, iron on backing.' },
  { language: 'en', title: 'Leather Belt', description: 'Brown belt with metal buckle, 4 cm wide, size adjustable.' },
  { language: 'en', title: 'Cosplay Commission', description: 'Open for commissions. Message me your character and I will quote.' },
  { language: 'en', title: 'Made to Order Costume', description: 'Everything is made to order. Send your measurements after ordering.' },
  { language: 'en', title: 'Group Costume Order', description: 'Ordering for a group of five, same design, different sizes.' },
  { language: 'en', title: 'Wig Styling Service', description: 'I will cut and style your own wig for your character.' },
  { language: 'en', title: 'Prop Making Service', description: 'EVA foam props made from a reference photo, message for a quote.' },
  { language: 'en', title: 'Condition Report Card', description: 'Every listing gets a condition card with photos of the flaws.' },
  { language: 'en', title: 'Authentic Screen Print Tee', description: 'Screen printed tee, official seller, still has the tags.' },
  { language: 'en', title: 'Claws', description: 'Foam claw props, pair, painted black with red tips.' },
  { language: 'en', title: 'Sherpa Hood', description: 'Sherpa lined hood for a winter costume, detaches.' },
  { language: 'en', title: 'Ribbon Collar', description: 'Velvet ribbon collar, 3 cm wide, fits a 14 inch neck.' },
  { language: 'en', title: 'Bodysuit', description: 'Stretch bodysuit, black, size small, no stretch marks.' },
  { language: 'en', title: 'Kigurumi Onesie', description: 'Plush animal onesie, adult size, washable.' },
  { language: 'en', title: 'Face Paint Palette', description: 'Twelve colour face paint palette, still sealed.' },
  { language: 'en', title: 'Contact Lenses', description: 'Coloured contacts in a circle lens case, 14mm.' },
  { language: 'en', title: 'Ear Pointers', description: 'Animal ear headband pointers, black, elastic band.' },
  { language: 'en', title: 'Character Costume Budget', description: 'Budget costume for my first convention, simple but complete.' },
  { language: 'en', title: 'Second Hand Costume', description: 'Pre owned costume from a convention two years ago, still wearable.' },
  { language: 'en', title: 'Lace Trim', description: 'One metre of black lace trim, cut from a longer piece.' },
  { language: 'en', title: 'Coat', description: 'Long wool coat with a belt, size medium, dry cleaned.' },
  { language: 'en', title: 'Gloves', description: 'Long white gloves, one size, stretchy knit.' },

  { language: 'tl', title: 'Wig', description: 'Maikling na itim na wig, bagong bago.' },
  { language: 'tl', title: 'Shoes', description: 'Itim na sapatos, laki 7, kaunti ang gamit.' },
  { language: 'tl', title: 'Damit', description: 'Babaeng damit na cosplay, handa nang suotin.' },
  { language: 'tl', title: 'Kalakaland', description: 'Masarap magandang nakababaeng kalakal, tawag sa akin.' },
  { language: 'tl', title: 'Nakababaeng wig', description: 'Pula na wig para sa cosplay, magandang kalidad.' },
  { language: 'tl', title: 'Nais kong gawin', description: 'Gusto kong gumawa ng bagong kostyum para sa akin.' },
  { language: 'tl', title: 'Taga bahay', description: 'Ginawa ko ito sa aming bahay sa Quezon.' },
  { language: 'tl', title: 'Malaking mapa', description: 'Malaking mapa para sa aking kailangan sa proyekto.' },
  { language: 'tl', title: 'Nakatingin', description: 'Nakatingin ako sa espasyo para sa aking bagong proyekto.' },
  { language: 'tl', title: 'Ginawa namin', description: 'Ginawa namin ito para sa aming grupo sa kolehiyo.' },
  { language: 'tl', title: 'Maraming salamat', description: 'Maraming salamat sa lahat ng tumulong sa akin.' },
  { language: 'tl', title: 'Bago pa', description: 'Bago pa ang mga damit na ito ay ginawa para sa akin.' },
  { language: 'tl', title: 'Mukhang bago', description: 'Mukhang bago ang mga ito, napapanatili ko nang maayos.' },
  { language: 'tl', title: 'Mas mababa', description: 'Mas mababa ang halaga kaysa sa mga luma.' },
  { language: 'tl', title: 'Nagawa na', description: 'Nagawa na ko ang lahat ng kailangan para sa cosplay ko.' },
  { language: 'tl', title: 'Isang araw', description: 'Isang araw ko itong ginawa mula umaga hanggang gabi.' },
  { language: 'tl', title: 'Dalawang taon', description: 'Ginamit ko ito sa loob ng dalawang taon na.' },
  { language: 'tl', title: 'Marami ang tanong', description: 'Marami ang tanong tungkol sa mga detalye ng produkto.' },
  { language: 'tl', title: 'Tama ang laki', description: 'Tama ang laki para sa akin, nasukat ko na.' },
  { language: 'tl', title: 'Maliit na bahay', description: 'Maliit na bahay sa probinsiya, may malaking backyard.' },
  { language: 'tl', title: 'Walang bayad', description: 'Walang bayad sa pagpapadala kapag malaki ang order.' },
  { language: 'tl', title: 'Mabuting kalidad', description: 'Mabuting kalidad ang tela, matibay at hindi madaling maputi.' },
  { language: 'tl', title: 'Buhay at maayos', description: 'Naiintindihan ko na buhay at maayos ang gamit ng bawat isa.' },
  { language: 'tl', title: 'Nagtratrabaho ako', description: 'Nagtratrabaho ako mula umaga para sa aming pamilya.' },
  { language: 'tl', title: 'Nag-aaral ako', description: 'Nag-aaral ako ng cosplay tuwing libre ang aking oras.' },
  { language: 'tl', title: 'Gusto kong matuto', description: 'Gusto kong matuto ng bagong kasanayan sa paggawa ng kostyum.' },
  { language: 'tl', title: 'Kasal', description: 'Maganda ang tela na ito para sa kasal ng aking pinsan.' },
  { language: 'tl', title: 'Kulang', description: 'Kulang yung shoulder pad ko, kailangan ko pa ng isa.' },
  { language: 'tl', title: 'Napaka ganda', description: 'Napaka ganda ng kulay nito sa totoong buhay.' },
  { language: 'tl', title: 'Saan', description: 'Saan nakikita ang mga ito? Nasa tabi ng bahay namin.' },
  { language: 'tl', title: 'Alin', description: 'Alin ang gusto mo, ito o iyon?' },
  { language: 'tl', title: 'Oras', description: 'Oras ng pagbubukas: Lunes hanggang Sabado, umaga hanggang hatinggabi.' },
  { language: 'tl', title: 'Bahay', description: 'Bahay na bakal na may tatlong kwarto at malayong lumbas.' },
  { language: 'tl', title: 'Trabaho', description: 'Trabaho ko ang paggawa ng mga costume sa aming maliit na tindahan.' },
  { language: 'tl', title: 'Bansa', description: 'Bansa ko ang Pilipinas, nakatira ako sa Maynila.' },
  { language: 'tl', title: 'Pagkain', description: 'Pagkain ang aming paboritong pagkain tuwing Sabado.' },

  { language: 'taglish', title: 'Wig', description: 'Itim na wig, bago, fits sa head ko.' },
  { language: 'taglish', title: 'Cosplay set', description: 'Complete na cosplay set, lahat ng parts kasama na.' },
  { language: 'taglish', title: 'Custom order', description: 'Accept ko ang custom order, message me for details.' },
  { language: 'taglish', title: 'Price', description: 'Price is negotiable,pero minimum is yung sinabi ko.' },
  { language: 'taglish', title: 'Condition', description: 'Used na pero okay pa ang condition, walang tear.' },
  { language: 'taglish', title: 'Size', description: 'Size is medium,pero pwede pa ring i-adjust.' },
  { language: 'taglish', title: 'Meet up', description: 'Meet up sa mall, or pwede rin ako mag-deliver.' },
  { language: 'taglish', title: 'Freebies', description: 'May freebies kapag bumili kayo ng dalawa.' },
  { language: 'taglish', title: 'Like new', description: 'Like newCondition, ginamit lang isang beses.' },
  { language: 'taglish', title: 'Open for order', description: 'Open for order this coming week, slots lang ang baka.' },
  { language: 'taglish', title: 'Nice quality', description: 'Nice quality ang tela, matibay at comfortable.' },
  { language: 'taglish', title: 'Check the photos', description: 'Check the photos para sa actual na itsura.' },
  { language: 'taglish', title: 'Ships nationwide', description: 'Ships nationwide, COD or bank transfer.' },
  { language: 'taglish', title: 'Push na lang', description: 'Push na lang sa weekend para sa event.' },
  { language: 'taglish', title: 'Made with love', description: 'Made with love, lahat ng detalye handcrafted.' },
  { language: 'taglish', title: 'Second hand', description: 'Second hand pero linis at ayos pa ang labas.' },
];

// ---------------------------------------------------------------------------
// Nonsense that must fail, generated so the file is not full of literal junk.
// ---------------------------------------------------------------------------

/** Deterministic generator, so re-running writes the same file. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const random = makeRandom(20261005);
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

const randomString = (length: number) => {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  return out;
};

const MASH_ROWS = [
  'qwertyuiop', 'asdfghjkl', 'zxcvbnmqwe', 'tyuiopasdf', 'ghjklzxcvb',
  'qazwsxedcr', 'plokijuhyg', 'mnbvcxzlkj', 'qweasdzxc', 'asdzxcqwe',
  'poiuytrewq', 'lkjhgfdsaz', 'mnbvcxzqwe', 'tyuiuytrewq', 'asdfghjklas',
  'qwertyasdfg', 'zxcvbnmzxcv', 'poiuytghjkl', 'qazxswedcrfv', 'plmokn9876',
];

const REPEAT_ROWS = [
  'aaaaaaaa', 'aaaaa', 'llllllllll', 'ssssssssss', 'mmmmmmmm', 'iiiiiiiiii',
  'oooooooooo', 'nnnnnnnnnnnn', 'lllllllllllllll', 'sssssssssssssss',
  'eeeeeeeeee', 'ddddddddddd', 'kkkkkkkkkkk', 'ttttttttttt', 'yyyyyyyyy',
];

const REAL_WORDS = [
  'Wig', 'costume', 'sewing', 'listing', 'price', 'shipping', 'cosplay',
  'condition', 'custom', 'order', 'complete', 'brand', 'new',
];

const MIXED_ROWS = [
  'zzq wig vwkk', 'qxz costume jjj', 'Wig plm okij', 'xcv listing qqwe',
  'tyu price uio', 'asd order zxc', 'Wig qwe rty', 'fgh new poi',
  'plm costume zxc', 'qwe complete tyu', 'Wig asd zxc', 'lkj shipping poi',
  'qaz custom wsx', 'edc price rfv', 'tgb condition yhn', 'Wig ujm vbn',
];

const gibberish: { kind: string; title: string; description: string }[] = [];
for (const mash of MASH_ROWS) {
  gibberish.push({ kind: 'keyboard_mash', title: mash, description: mash });
}
for (const repeat of REPEAT_ROWS) {
  gibberish.push({ kind: 'repeated_letters', title: repeat, description: repeat });
}
for (let i = 0; i < 20; i++) {
  gibberish.push({
    kind: 'random_letters',
    title: randomString(6 + Math.floor(random() * 8)),
    description: randomString(20 + Math.floor(random() * 40)),
  });
}
for (const mixed of MIXED_ROWS) {
  const parts = mixed.split(' ');
  gibberish.push({ kind: 'mixed_gibberish', title: parts[0], description: mixed });
}

const payload = {
  schema_version: 1,
  note: 'Held-out set for the listing plausibility check in src/marketplace/quality.ts. Real listing texts must pass; generated letter sequences must fail. Built by scripts/build-quality-testset.ts.',
  must_pass: REAL,
  must_fail: gibberish,
};

writeFileSync(join(ROOT, 'data/quality_testset.json'), JSON.stringify(payload, null, 2), 'utf8');

const byLang = new Map<string, number>();
for (const r of REAL) byLang.set(r.language, (byLang.get(r.language) ?? 0) + 1);
console.log(`must_pass rows: ${REAL.length}`);
for (const [lang, n] of byLang) console.log(`  ${lang}: ${n}`);
const byKind = new Map<string, number>();
for (const g of gibberish) byKind.set(g.kind, (byKind.get(g.kind) ?? 0) + 1);
console.log(`must_fail rows: ${gibberish.length}`);
for (const [kind, n] of byKind) console.log(`  ${kind}: ${n}`);
/** TEMP: writes blocked_inputs_tl.json from curated TL terms. Prints counts only. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = join(process.env.TEMP!, 'opencode', 'blocked_inputs_tl.json');
const data = JSON.parse(readFileSync(join(process.cwd(), 'src', 'moderation', 'data', 'blocked_terms_tl.json'), 'utf8'));

const pick = (cls: string): string[] =>
  data.terms.filter((t: any) => t.source === 'curated' && t.class === cls).map((t: any) => String(t.term));

const adult = pick('adult');
const prohibited = pick('prohibited');
const vulgar = pick('vulgar');

const rows: Array<{ title: string; description: string; category: string }> = [];
if (prohibited[0]) rows.push({ title: `Benta ang ${prohibited[0]}`, description: `Handa nang ipadala sa inyo ang ${prohibited[0]} ngayon din.`, category: 'Props & Accessories' });
if (vulgar[0]) rows.push({ title: `Murang ${vulgar[0]}`, description: `Order na po, ${vulgar[0]} available ngayon.`, category: 'Costumes & Cosplay' });
if (adult[0]) rows.push({ title: `${adult[0]} na costume`, description: `Gawa sa manipis na tela ang ${adult[0]} na ito.`, category: 'Costumes & Cosplay' });

writeFileSync(out, JSON.stringify(rows, null, 2), 'utf8');
console.log(`wrote rows=${rows.length} source_counts adult=${adult.length} prohibited=${prohibited.length} vulgar=${vulgar.length} file_bytes=${JSON.stringify(rows).length}`);

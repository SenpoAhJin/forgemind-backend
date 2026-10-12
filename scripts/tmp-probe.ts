/** TEMP: key names and counts only. Never prints row content. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const lines = readFileSync(join(process.cwd(), 'data', 'labeled_listings.jsonl'), 'utf8').split('\n').filter((l) => l.trim());
const keyCount = new Map<string, number>();
let withTitle = 0; let withDesc = 0;
for (const line of lines) {
  const rec = JSON.parse(line);
  for (const k of Object.keys(rec)) keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
  if (typeof rec.title === 'string' && rec.title.trim()) withTitle += 1;
  if (typeof rec.description === 'string' && rec.description.trim()) withDesc += 1;
}
console.log(`rows=${lines.length} with_nonempty_title=${withTitle} with_nonempty_description=${withDesc}`);
console.log(`keys=${[...keyCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ')}`);

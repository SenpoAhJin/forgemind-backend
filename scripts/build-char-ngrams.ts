/**
 * Builds character trigram model from clean marketplace listings.
 *
 * Learns letter trigram frequencies from allowed listings to detect gibberish.
 * Uses Laplace smoothing and prunes low-probability entries to keep under 1MB.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface TrigramCounts {
  [trigram: string]: number;
}

const SMOOTHING = 1; // Laplace smoothing
const MIN_PROB_THRESHOLD = 0.00001; // Prune trigrams below this probability

async function main() {
  const cleanTexts: string[] = [];
  
  // Read labeled_listings.jsonl
  const jsonlPath = path.join(__dirname, '../data/labeled_listings.jsonl');
  if (fs.existsSync(jsonlPath)) {
    const fileStream = fs.createReadStream(jsonlPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    
    for await (const line of rl) {
      try {
        const obj = JSON.parse(line);
        if (obj.label === 'allowed' || obj.label === 'clean') {
          if (obj.title) cleanTexts.push(obj.title);
          if (obj.description) cleanTexts.push(obj.description);
        }
      } catch {}
    }
  }

  // Read train.csv (main dataset)
  const trainPath = path.join(__dirname, '../../forgemind-ai/marketplace_datasets/train.csv');
  if (fs.existsSync(trainPath)) {
    const lines = fs.readFileSync(trainPath, 'utf-8').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(',');
      if (parts.length >= 2) {
        // Check if toxic flags are 0 (clean)
        const toxic = parseInt(parts[2]) || 0;
        const severe = parseInt(parts[3]) || 0;
        const obscene = parseInt(parts[4]) || 0;
        const threat = parseInt(parts[5]) || 0;
        const insult = parseInt(parts[6]) || 0;
        const hate = parseInt(parts[7]) || 0;
        
        if (toxic === 0 && severe === 0 && obscene === 0 && threat === 0 && insult === 0 && hate === 0) {
          cleanTexts.push(parts[1]); // comment_text
        }
      }
    }
  }

  // Read Tagalog clean data
  const tagalogTrainPath = path.join(__dirname, '../../forgemind-ai/marketplace_datasets/Tagalog_Datasets/train.csv');
  if (fs.existsSync(tagalogTrainPath)) {
    const lines = fs.readFileSync(tagalogTrainPath, 'utf-8').split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(',');
      if (parts.length >= 2 && parts[1] === '0') {
        cleanTexts.push(parts[0]); // text
      }
    }
  }

  console.log(`Collected ${cleanTexts.length} clean texts`);

  // Build trigram counts
  const trigramCounts: TrigramCounts = {};
  let totalTrigrams = 0;

  for (const text of cleanTexts) {
    const normalized = text.toLowerCase().replace(/[^a-z]/g, '');
    for (let i = 0; i < normalized.length - 2; i++) {
      const trigram = normalized.substring(i, i + 3);
      trigramCounts[trigram] = (trigramCounts[trigram] || 0) + 1;
      totalTrigrams++;
    }
  }

  // Apply Laplace smoothing and calculate probabilities
  const vocabulary = Object.keys(trigramCounts).length;
  const smoothedTotal = totalTrigrams + vocabulary * SMOOTHING;
  
  const trigramProbs: { [key: string]: number } = {};
  for (const [trigram, count] of Object.entries(trigramCounts)) {
    const prob = (count + SMOOTHING) / smoothedTotal;
    if (prob >= MIN_PROB_THRESHOLD) {
      trigramProbs[trigram] = Math.log(prob); // Store log probability
    }
  }

  console.log(`Total trigrams: ${vocabulary}, after pruning: ${Object.keys(trigramProbs).length}`);

  // Save to JSON
  const outputPath = path.join(__dirname, '../src/marketplace/data/char_ngrams.json');
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(trigramProbs, null, 2));
  
  const sizeKB = Math.round(fs.statSync(outputPath).size / 1024);
  console.log(`Saved to ${outputPath} (${sizeKB} KB)`);
}

main().catch(console.error);

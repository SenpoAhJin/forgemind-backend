/**
 * Tune quality check thresholds on training data.
 */

import * as fs from 'fs';
import * as path from 'path';
import { checkListingQuality } from '../src/marketplace/quality';

async function main() {
  const testset = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/quality_testset.json'), 'utf-8'));
  
  // Test on synthetic testset
  console.log('\n=== Testset Results ===');
  let realPass = 0;
  let realFail = 0;
  let gibbPass = 0;
  let gibbFail = 0;
  
  for (const text of testset.real) {
    const result = checkListingQuality({ title: text, description: text });
    if (result.ok) realPass++;
    else realFail++;
  }
  
  for (const text of testset.gibberish) {
    const result = checkListingQuality({ title: text, description: text });
    if (result.ok) gibbPass++;
    else gibbFail++;
  }
  
  console.log(`Real texts: ${realPass} pass, ${realFail} fail (${Math.round(realPass / testset.real.length * 100)}% pass)`);
  console.log(`Gibberish: ${gibbPass} pass, ${gibbFail} fail (${Math.round(gibbFail / testset.gibberish.length * 100)}% rejected)`);
  
  // Test on train.csv clean rows (up to 20K)
  console.log('\n=== Train.csv Clean Rows (sample) ===');
  const trainPath = path.join(__dirname, '../../forgemind-ai/marketplace_datasets/train.csv');
  if (fs.existsSync(trainPath)) {
    const lines = fs.readFileSync(trainPath, 'utf-8').split('\n');
    let cleanChecked = 0;
    let cleanRejected = 0;
    
    for (let i = 1; i < Math.min(lines.length, 20001); i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const parts = line.split(',');
      if (parts.length >= 2) {
        const toxic = parseInt(parts[2]) || 0;
        const severe = parseInt(parts[3]) || 0;
        const obscene = parseInt(parts[4]) || 0;
        const threat = parseInt(parts[5]) || 0;
        const insult = parseInt(parts[6]) || 0;
        const hate = parseInt(parts[7]) || 0;
        
        if (toxic === 0 && severe === 0 && obscene === 0 && threat === 0 && insult === 0 && hate === 0) {
          const text = parts[1];
          const result = checkListingQuality({ title: text, description: text });
          cleanChecked++;
          if (!result.ok) cleanRejected++;
        }
      }
    }
    
    const falseRejectRate = cleanRejected / cleanChecked;
    console.log(`Clean rows checked: ${cleanChecked}, wrongly rejected: ${cleanRejected} (${(falseRejectRate * 100).toFixed(2)}% false reject rate)`);
  }
  
  // Test on val.csv
  console.log('\n=== Val.csv (held out) ===');
  const valPath = path.join(__dirname, '../../forgemind-ai/marketplace_datasets/val.csv');
  if (fs.existsSync(valPath)) {
    const lines = fs.readFileSync(valPath, 'utf-8').split('\n');
    let valCleanChecked = 0;
    let valCleanRejected = 0;
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      // val.csv format: ,label,,,,,
      if (line.startsWith(',0,') || line.includes(',0,')) {
        valCleanChecked++;
        const result = checkListingQuality({ title: line, description: line });
        if (!result.ok) valCleanRejected++;
      }
    }
    
    if (valCleanChecked > 0) {
      const valFalseRejectRate = valCleanRejected / valCleanChecked;
      console.log(`Val clean rows: ${valCleanChecked}, wrongly rejected: ${valCleanRejected} (${(valFalseRejectRate * 100).toFixed(2)}% false reject rate)`);
    }
  }
}

main().catch(console.error);

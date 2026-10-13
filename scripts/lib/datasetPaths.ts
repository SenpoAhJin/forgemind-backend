/**
 * Centralized dataset paths for chat moderation.
 * 
 * Resolves absolute paths to forgemind-ai/marketplace_datasets
 * and validates file existence at import time.
 */

import * as path from 'path';
import * as fs from 'fs';

// Base: forgemind-backend/scripts -> ../forgemind-ai/marketplace_datasets
const DATASETS_BASE = path.resolve(__dirname, '..', '..', '..', 'forgemind-ai', 'marketplace_datasets');

if (!fs.existsSync(DATASETS_BASE)) {
  throw new Error(`Dataset directory not found: ${DATASETS_BASE}`);
}

// Tagalog datasets
export const TAGALOG_TRAIN = path.join(DATASETS_BASE, 'Tagalog_Datasets', 'train.csv');
export const TAGALOG_VAL = path.join(DATASETS_BASE, 'Tagalog_Datasets', 'val.csv');

// English datasets (Jigsaw Toxic Comments, in processed/ folder)
// Fixed-seed split: train 691,011 rows (376,089 benign, 23,206 toxic)
//                   test 289,154 rows (157,136 benign, 9,593 toxic)
//                   val 234,906 rows (128,115 benign, 7,974 toxic)
// Columns: id, text, field, source, clean, vulgar, hate, adult, prohibited, unrelated
// Label: clean=1 for benign, any of (vulgar|hate|adult|prohibited)=1 for toxic
export const ENGLISH_TRAIN = path.join(DATASETS_BASE, 'processed', 'train.csv');
export const ENGLISH_TEST = path.join(DATASETS_BASE, 'processed', 'test.csv');
export const ENGLISH_VAL = path.join(DATASETS_BASE, 'processed', 'val.csv');

// Benign sets
export const BENIGN_MARKETPLACE = path.resolve(__dirname, '..', 'data', 'benign_marketplace.txt');
export const BENIGN_USER = path.resolve(__dirname, '..', 'data', 'benign_user.txt');

// Explicit datasets
export const EXPLICIT_DATASETS_DIR = path.join(DATASETS_BASE, 'Explicit_Datasets');

// Block words (actual filenames with hashes)
// NOTE: Both files are IDENTICAL (SHA256: 9BD61C6EA3BFF2440A21051F68983ABB07354FE645860D47782D043537C73EBC)
// Use BLOCK_WORDS_PART1 only to avoid double-counting
export const BLOCK_WORDS_PART1 = path.join(DATASETS_BASE, 'Block_Words_Part1_0a5e31bd.csv');
export const BLOCK_WORDS_PART1_DUP = path.join(DATASETS_BASE, 'Block_Words_Part1_0a5e31bd (1).csv');

// Marketplace listing data (with typo "martket" in filenames, actual names with hashes)
export const MARKETPLACE_DATA_PART2 = path.join(DATASETS_BASE, 'market_place_datasets_12b05540_Part2.csv');
export const MARKETPLACE_DATA_PART3 = path.join(DATASETS_BASE, 'martket_place_datasets_8574d8ce_part3.csv');

// Processed directory
export const PROCESSED_DIR = path.join(DATASETS_BASE, 'processed');

/**
 * Validate paths and report missing files.
 * Call this to check dataset availability.
 */
export function validateDatasets(): { path: string; exists: boolean }[] {
  const paths = [
    { name: 'TAGALOG_TRAIN', path: TAGALOG_TRAIN },
    { name: 'TAGALOG_VAL', path: TAGALOG_VAL },
    { name: 'ENGLISH_TRAIN', path: ENGLISH_TRAIN },
    { name: 'ENGLISH_TEST', path: ENGLISH_TEST },
    { name: 'ENGLISH_VAL', path: ENGLISH_VAL },
    { name: 'BENIGN_MARKETPLACE', path: BENIGN_MARKETPLACE },
    { name: 'BENIGN_USER', path: BENIGN_USER },
    { name: 'EXPLICIT_DATASETS_DIR', path: EXPLICIT_DATASETS_DIR },
    { name: 'BLOCK_WORDS_PART1', path: BLOCK_WORDS_PART1 },
    { name: 'BLOCK_WORDS_PART1_DUP', path: BLOCK_WORDS_PART1_DUP },
    { name: 'MARKETPLACE_DATA_PART2', path: MARKETPLACE_DATA_PART2 },
    { name: 'MARKETPLACE_DATA_PART3', path: MARKETPLACE_DATA_PART3 },
    { name: 'PROCESSED_DIR', path: PROCESSED_DIR },
  ];

  return paths.map(p => ({
    path: p.path,
    exists: fs.existsSync(p.path)
  }));
}

// Print resolved base path for verification
console.log(`[datasetPaths] Base: ${DATASETS_BASE}`);

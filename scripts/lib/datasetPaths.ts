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

// English datasets (NOT PRESENT - no English_Datasets folder exists)
// Historical reports mentioned English held-out but files are missing
export const ENGLISH_TRAIN = path.join(DATASETS_BASE, 'English_Datasets', 'train.csv');
export const ENGLISH_TEST = path.join(DATASETS_BASE, 'English_Datasets', 'test.csv');

// Benign sets
export const BENIGN_MARKETPLACE = path.resolve(__dirname, '..', 'data', 'benign_marketplace.txt');
export const BENIGN_USER = path.resolve(__dirname, '..', 'data', 'benign_user.txt');

// Explicit datasets
export const EXPLICIT_DATASETS_DIR = path.join(DATASETS_BASE, 'Explicit_Datasets');

// Block words (actual filenames with hashes)
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

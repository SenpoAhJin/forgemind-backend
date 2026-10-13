/**
 * Dataset Inventory
 * 
 * Lists all dataset files with row counts, columns, label distributions.
 * NO text content printed (counts only).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as datasetPaths from './lib/datasetPaths';

interface DatasetInfo {
  file: string;
  exists: boolean;
  rows?: number;
  columns?: number;
  labelColumn?: string;
  labelCounts?: Record<string, number>;
  language?: string;
  contentType?: string;
  error?: string;
}

function readCsvInfo(filePath: string): Partial<DatasetInfo> {
  if (!fs.existsSync(filePath)) {
    return { exists: false };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
    const lines = content.split('\n').filter(l => l.trim());
    
    if (lines.length === 0) {
      return { exists: true, rows: 0, error: 'Empty file' };
    }

    // Parse header
    const header = lines[0].split(',').map(h => h.trim());
    const columns = header.length;

    // Detect label column
    let labelColumn: string | undefined;
    let labelIndex = -1;
    
    if (header.includes('label')) {
      labelColumn = 'label';
      labelIndex = header.indexOf('label');
    } else if (header.includes('toxic')) {
      labelColumn = 'toxic';
      labelIndex = header.indexOf('toxic');
    }

    // Count labels
    const labelCounts: Record<string, number> = {};
    
    if (labelIndex >= 0) {
      for (let i = 1; i < lines.length; i++) {
        const match = /,(\d+)$/.exec(lines[i]);
        if (match) {
          const label = match[1];
          labelCounts[label] = (labelCounts[label] || 0) + 1;
        }
      }
    }

    return {
      exists: true,
      rows: lines.length - 1, // Exclude header
      columns,
      labelColumn,
      labelCounts: Object.keys(labelCounts).length > 0 ? labelCounts : undefined,
    };
  } catch (err: any) {
    return { exists: true, error: err.message };
  }
}

function readTxtInfo(filePath: string): Partial<DatasetInfo> {
  if (!fs.existsSync(filePath)) {
    return { exists: false };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    
    return {
      exists: true,
      rows: lines.length,
      columns: 1,
      contentType: 'text',
    };
  } catch (err: any) {
    return { exists: true, error: err.message };
  }
}

function checkDirectory(dirPath: string): Partial<DatasetInfo> {
  if (!fs.existsSync(dirPath)) {
    return { exists: false };
  }

  try {
    const items = fs.readdirSync(dirPath);
    const files = items.filter(item => {
      const fullPath = path.join(dirPath, item);
      return fs.statSync(fullPath).isFile();
    });
    
    return {
      exists: true,
      rows: files.length,
      contentType: 'directory',
    };
  } catch (err: any) {
    return { exists: true, error: err.message };
  }
}

function main() {
  console.log('=== Dataset Inventory ===\n');

  const datasets: DatasetInfo[] = [
    {
      file: 'Tagalog train.csv',
      language: 'Tagalog/Filipino',
      contentType: 'text',
      ...readCsvInfo(datasetPaths.TAGALOG_TRAIN)
    },
    {
      file: 'Tagalog val.csv',
      language: 'Tagalog/Filipino',
      contentType: 'text',
      ...readCsvInfo(datasetPaths.TAGALOG_VAL)
    },
    {
      file: 'English train.csv',
      language: 'English',
      contentType: 'text',
      ...readCsvInfo(datasetPaths.ENGLISH_TRAIN)
    },
    {
      file: 'English test.csv',
      language: 'English',
      contentType: 'text',
      ...readCsvInfo(datasetPaths.ENGLISH_TEST)
    },
    {
      file: 'benign_marketplace.txt',
      language: 'Mixed (EN/TL)',
      contentType: 'text',
      ...readTxtInfo(datasetPaths.BENIGN_MARKETPLACE)
    },
    {
      file: 'benign_user.txt',
      language: 'Mixed (EN/TL)',
      contentType: 'text',
      ...readTxtInfo(datasetPaths.BENIGN_USER)
    },
    {
      file: 'Explicit_Datasets/ (directory)',
      language: 'Various',
      contentType: 'directory',
      ...checkDirectory(datasetPaths.EXPLICIT_DATASETS_DIR)
    },
    {
      file: 'Block_Words_Part1_0a5e31bd.csv',
      language: 'Various',
      contentType: 'text',
      ...readCsvInfo(datasetPaths.BLOCK_WORDS_PART1)
    },
    {
      file: 'Block_Words_Part1_0a5e31bd (1).csv',
      language: 'Various',
      contentType: 'text',
      ...readCsvInfo(datasetPaths.BLOCK_WORDS_PART1_DUP)
    },
    {
      file: 'market_place_datasets_12b05540_Part2.csv',
      language: 'Various',
      contentType: 'listings',
      ...readCsvInfo(datasetPaths.MARKETPLACE_DATA_PART2)
    },
    {
      file: 'martket_place_datasets_8574d8ce_part3.csv',
      language: 'Various',
      contentType: 'listings',
      ...readCsvInfo(datasetPaths.MARKETPLACE_DATA_PART3)
    },
    {
      file: 'processed/ (directory)',
      language: 'Various',
      contentType: 'directory',
      ...checkDirectory(datasetPaths.PROCESSED_DIR)
    },
  ];

  // Print table
  console.log('| File | Exists | Rows | Cols | Label Col | Label Counts | Language | Type |');
  console.log('|------|--------|------|------|-----------|--------------|----------|------|');

  for (const ds of datasets) {
    const exists = ds.exists ? '✓' : '✗';
    const rows = ds.rows !== undefined ? ds.rows.toString() : '-';
    const cols = ds.columns !== undefined ? ds.columns.toString() : '-';
    const labelCol = ds.labelColumn || '-';
    const labelCounts = ds.labelCounts
      ? Object.entries(ds.labelCounts).map(([k, v]) => `${k}:${v}`).join(', ')
      : '-';
    const lang = ds.language || '-';
    const type = ds.contentType || '-';
    
    console.log(`| ${ds.file} | ${exists} | ${rows} | ${cols} | ${labelCol} | ${labelCounts} | ${lang} | ${type} |`);
    
    if (ds.error) {
      console.log(`  ERROR: ${ds.error}`);
    }
  }

  console.log('\n=== Missing Files ===\n');
  
  const missing = datasets.filter(d => !d.exists);
  if (missing.length === 0) {
    console.log('All files found!\n');
  } else {
    for (const ds of missing) {
      console.log(`✗ ${ds.file}`);
    }
    console.log();
  }
}

main();

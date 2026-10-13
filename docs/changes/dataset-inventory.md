# Dataset Inventory - Chat Moderation

**Base Path:** `CosForge_System - Copy\forgemind-ai\marketplace_datasets`

**Last Updated:** 2026-10-14 (Session 3 continuation)

## Summary

- **Tagalog datasets:** Train 11,110 rows (6,413 benign, 4,697 toxic), Val 2,778 rows (1,604 benign, 1,174 toxic)
- **English datasets:** Found in `processed/` folder - Train 691,011 rows (376,089 benign, 23,206 toxic), Test 289,154 rows (157,136 benign, 9,593 toxic), Val 234,906 rows (128,115 benign, 7,974 toxic)
- **Block_Words files:** Both files are IDENTICAL (SHA256: 9BD61C6EA3BFF2440A21051F68983ABB07354FE645860D47782D043537C73EBC) - use Part1 only to avoid double-counting
- **Benign sets:** marketplace 210 rows, user 0 rows
- **Characters datasets:** Exists at `forgemind-ai/chracters_datasets` with subdirectories for character_images, cosplay_matches, custom_variant_refs, Female_3D_Model, Male_3D_Model, owned_attire (not used for chat moderation)

## Dataset Details

| File | Exists | Rows | Label Counts | Language | Type | Notes |
|------|--------|------|--------------|----------|------|-------|
| **Tagalog_Datasets/** |
| train.csv | ✓ | 11,110 | 0:6,413, 1:4,697 | Tagalog/Filipino | text | label: 0=benign, 1=toxic |
| val.csv | ✓ | 2,778 | 0:1,604, 1:1,174 | Tagalog/Filipino | text | label: 0=benign, 1=toxic |
| **processed/** |
| train.csv | ✓ | 688,619 (126,968 labeled) | clean:117,890, toxic:9,078 | English | text | Jigsaw, multi-label, 81% unlabeled |
| test.csv | ✓ | 288,275 (52,819 labeled) | clean:49,105, toxic:3,714 | English | text | Jigsaw, multi-label, 82% unlabeled |
| val.csv | ✓ | 234,108 (43,088 labeled) | clean:39,897, toxic:3,191 | English | text | Jigsaw, multi-label, 82% unlabeled |
| **Block_Words/** |
| Part1_0a5e31bd.csv | ✓ | 5,987 | class: 0,1,2 | English | text | Hate speech dataset |
| Part1_0a5e31bd (1).csv | ✓ | 5,987 | class: 0,1,2 | English | text | DUPLICATE of above |
| **Benign sets** |
| benign_marketplace.txt | ✓ | 210 | - | Mixed (EN/TL) | text | Real marketplace messages |
| benign_user.txt | ✓ | 0 | - | Mixed (EN/TL) | text | Empty |
| **Marketplace listings** |
| market_place_datasets_12b05540_Part2.csv | ✓ | 403 | - | Various | listings | Not for chat |
| martket_place_datasets_8574d8ce_part3.csv | ✓ | 14 | - | Various | listings | Not for chat (typo in filename) |
| **Image datasets** |
| Explicit_Datasets/ | ✓ | - | - | Various | images | JPG files, not for text chat |

## Schema Details

### Tagalog Datasets (train.csv, val.csv)
- **Columns:** text, label
- **Label:** 0 = benign, 1 = toxic

### English Datasets (processed/train.csv, test.csv, val.csv)
- **Columns:** id, text, field, source, clean, vulgar, hate, adult, prohibited, unrelated
- **Source:** Jigsaw Toxic Comments (indicated by id prefix "jigsaw_")
- **Labels:** 
  - clean=1: benign text
  - toxic: any of (vulgar=1 OR hate=1 OR adult=1 OR prohibited=1)
- **Fixed-seed split:** Deterministic train/test/val split for reproducible measurements
- **Label Audit Finding:** Most rows have non-numeric label values (e.g., "jigsaw_slice", "description") in label columns, indicating CSV parsing issues or source data format mismatch. Only rows with clean=1/0 and numeric toxic flags are usable.
  - Train: 688,619 total rows, 126,968 labeled (117,890 benign, 9,078 toxic), 561,651 missing/malformed
  - Test: 288,275 total rows, 52,819 labeled (49,105 benign, 3,714 toxic), 235,456 missing/malformed
  - Val: 234,108 total rows, 43,088 labeled (39,897 benign, 3,191 toxic), 191,020 missing/malformed
- **Strict Definition:** Rows with missing labels are EXCLUDED everywhere, never treated as benign

### Block_Words (Part1_0a5e31bd.csv)
- **Columns:** count, hate_speech, offensive_language, neither, class, tweet
- **Class:** 0 = hate_speech, 1 = offensive_language, 2 = neither
- **Note:** Both Part1 files have identical SHA256 hashes - only use one to avoid double-counting support

## Historical Notes

- **Session 2 (Oct 13 18:00-18:25):** Initial inventory created, wrongly concluded "English datasets NOT PRESENT" without checking processed/ folder
- **Session 3 continuation (Oct 14):** Corrected - English data FOUND in processed/ folder with 1.2M+ rows across train/test/val splits
- **Block_Words verification:** SHA256 hash confirms both files are identical - use Part1 only in mining scripts

## Characters Datasets Structure

The `chracters_datasets` folder contains:
- `character_images/` - Character reference images organized by character name
- `cosplay_matches/` - Cosplay matching data
- `custom_variant_refs/` - Custom variant references
- `Female_3D_Model/` - Female 3D model assets
- `Male_3D_Model/` - Male 3D model assets
- `owned_attire/` - Owned attire data

**Not used for chat moderation** - these are for the character/cosplay system.

## Access

All dataset paths are centralized in `scripts/lib/datasetPaths.ts` with:
- Absolute path resolution from script location
- Export constants for each dataset
- `validateDatasets()` function to check file existence

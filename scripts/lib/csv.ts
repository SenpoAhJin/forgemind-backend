/**
 * RFC4180-compliant CSV Parser
 * 
 * Handles:
 * - Quoted fields with newlines: "line1\nline2"
 * - Escaped quotes: "he said ""hello"""
 * - Mixed quoted/unquoted fields
 * 
 * Used for English Jigsaw datasets where comments contain newlines.
 */

export interface CsvRow {
  [key: string]: string;
}

/**
 * Parse CSV content with proper quote handling.
 * Returns array of row objects with header keys.
 * 
 * Special handling: if entire header is one quoted field with commas,
 * treat it as a CSV-within-CSV and split it properly.
 */
export function parseCsv(content: string, hasHeader = true): CsvRow[] {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote
          currentField += '"';
          i++; // Skip next quote
        } else {
          // End of quoted field
          inQuotes = false;
        }
      } else {
        // Inside quoted field (including newlines)
        currentField += char;
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true;
      } else if (char === ',') {
        // Field separator
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\n') {
        // Row separator (only outside quotes)
        if (currentField.length > 0 || currentRow.length > 0) {
          currentRow.push(currentField);
          lines.push(currentRow);
          currentRow = [];
          currentField = '';
        }
      } else if (char === '\r') {
        // Skip CR (handle CRLF)
        continue;
      } else {
        // Regular character
        currentField += char;
      }
    }
  }
  
  // Push last field and row
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    if (currentRow.some(f => f.length > 0)) {
      lines.push(currentRow);
    }
  }
  
  if (lines.length === 0) {
    return [];
  }
  
  if (!hasHeader) {
    // Return raw rows
    return lines.map((row, idx) => {
      const obj: CsvRow = {};
      row.forEach((val, colIdx) => {
        obj[`col${colIdx}`] = val;
      });
      return obj;
    });
  }
  
  // First line is header
  let header = lines[0];
  
  // Special case: entire header is one field containing comma-separated header names
  // (e.g., ",count,hate_speech,..." as a single quoted field)
  const headerIsQuotedCsv = header.length === 1 && header[0].includes(',');
  if (headerIsQuotedCsv) {
    header = header[0].split(',');
  }
  
  const rows: CsvRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    let row = lines[i];
    
    // If header was a quoted CSV, data rows are likely the same format
    // (one field containing comma-separated values)
    if (headerIsQuotedCsv && row.length === 1 && row[0].includes(',')) {
      row = row[0].split(',');
    }
    
    const obj: CsvRow = {};
    
    for (let j = 0; j < header.length; j++) {
      obj[header[j]] = row[j] || '';
    }
    
    rows.push(obj);
  }
  
  return rows;
}

/**
 * Unit test: synthetic sample with quoted newlines
 */
export function testCsvParser(): boolean {
  const sample = `id,text,label
1,"simple text",0
2,"text with
newline inside",1
3,"text with ""quotes""",0
4,unquoted text,1`;
  
  const rows = parseCsv(sample);
  
  // Expected 4 data rows
  if (rows.length !== 4) {
    console.error(`Expected 4 rows, got ${rows.length}`);
    return false;
  }
  
  // Row 1: simple
  if (rows[0].id !== '1' || rows[0].text !== 'simple text' || rows[0].label !== '0') {
    console.error('Row 1 failed:', rows[0]);
    return false;
  }
  
  // Row 2: newline in text
  if (rows[1].id !== '2' || !rows[1].text.includes('\n') || rows[1].label !== '1') {
    console.error('Row 2 failed (newline):', rows[1]);
    return false;
  }
  
  // Row 3: escaped quotes
  if (rows[2].id !== '3' || rows[2].text !== 'text with "quotes"' || rows[2].label !== '0') {
    console.error('Row 3 failed (quotes):', rows[2]);
    return false;
  }
  
  // Row 4: unquoted
  if (rows[3].id !== '4' || rows[3].text !== 'unquoted text' || rows[3].label !== '1') {
    console.error('Row 4 failed:', rows[3]);
    return false;
  }
  
  console.log('✓ CSV parser test passed');
  return true;
}

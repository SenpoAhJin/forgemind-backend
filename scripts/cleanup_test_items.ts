#!/usr/bin/env tsx
import { query } from '../dist/db.js';

async function cleanup() {
  const result = await query(
    `DELETE FROM owned_attire WHERE client_id LIKE $1 RETURNING attire_id`,
    ['attr-import-committed-%']
  );
  console.log(`Deleted ${result.length} test items`);
}

cleanup().catch(console.error);

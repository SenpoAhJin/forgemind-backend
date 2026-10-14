/**
 * Check for body_size_slider column in users table
 * Read-only SELECT/COUNT only
 */

import { config } from 'dotenv';
import { query } from '../src/db';

// Load environment variables
config();

async function checkBodySizeColumn() {
  try {
    // Check if column exists (query() returns rows array directly)
    const columnCheck = await query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'body_size_slider';
    `);

    console.log('=== Column Existence Check ===');
    if (columnCheck.length === 0) {
      console.log('body_size_slider column: NOT FOUND in users table');
    } else {
      console.log('body_size_slider column: EXISTS');
      console.log('Details:', columnCheck[0]);
    }
    console.log('');

    // Count users with non-null values
    const countResult = await query<{ total_users: string }>(`
      SELECT COUNT(*) as total_users FROM users;
    `);
    console.log('=== User Counts ===');
    console.log(`Total users: ${countResult[0].total_users}`);

    // Only check for non-null if column exists
    if (columnCheck.length > 0) {
      const nonNullResult = await query<{ non_null_count: string }>(`
        SELECT COUNT(*) as non_null_count
        FROM users
        WHERE body_size_slider IS NOT NULL;
      `);
      console.log(`Users with body_size_slider NOT NULL: ${nonNullResult[0].non_null_count}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error checking column:', error);
    process.exit(1);
  }
}

checkBodySizeColumn();

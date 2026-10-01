#!/usr/bin/env node
/**
 * Cleanup test accounts created during curl testing.
 * Deletes specific test accounts and their sessions.
 */

import { config as loadEnv } from 'dotenv';
import pg from 'pg';

loadEnv();

const pool = new pg.Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const testAccounts = [
  'curl_test_20261001123649@test.local',
  'head_curl_test_20261001124100@test.local',
  'staff_curl_test_20261001124202@test.local',
];

async function cleanup() {
  try {
    // Delete sessions for these accounts first (CASCADE will handle it, but explicit is clearer)
    const deleteSessionsResult = await pool.query(
      `DELETE FROM sessions WHERE user_id IN (
        SELECT user_id FROM users WHERE email = ANY($1::text[])
      )`,
      [testAccounts]
    );
    console.log(`Sessions deleted: ${deleteSessionsResult.rowCount}`);

    // Delete the accounts
    const deleteUsersResult = await pool.query(
      'DELETE FROM users WHERE email = ANY($1::text[])',
      [testAccounts]
    );
    console.log(`Users deleted: ${deleteUsersResult.rowCount}`);

    if (deleteUsersResult.rowCount !== 3) {
      console.warn(`Expected to delete 3 accounts, but deleted ${deleteUsersResult.rowCount}`);
    }
  } catch (error) {
    console.error('Cleanup failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

cleanup();

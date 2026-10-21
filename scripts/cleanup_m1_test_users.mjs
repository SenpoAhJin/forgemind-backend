#!/usr/bin/env node
/**
 * cleanup_m1_test_users.mjs
 * Remove all M1TEST_ users from database before running smoke tests
 */

import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;

// Load .env from forgemind-backend directory
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function cleanup() {
  const client = await pool.connect();
  try {
    // Delete all sessions for M1TEST_ users first (FK constraint)
    const sessionsResult = await client.query(`
      DELETE FROM sessions 
      WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'M1TEST_%')
    `);
    console.log(`✓ Deleted ${sessionsResult.rowCount} test sessions`);

    // Delete all owned_attire for M1TEST_ users
    const attireResult = await client.query(`
      DELETE FROM owned_attire 
      WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'M1TEST_%')
    `);
    console.log(`✓ Deleted ${attireResult.rowCount} test attire records`);

    // Delete M1TEST_ users
    const usersResult = await client.query(`
      DELETE FROM users WHERE email LIKE 'M1TEST_%'
    `);
    console.log(`✓ Deleted ${usersResult.rowCount} test users`);

    console.log('Cleanup complete');
  } catch (err) {
    console.error('Cleanup failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanup();

#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function check() {
  const users = await pool.query(`SELECT COUNT(*) as c FROM users WHERE email LIKE 'M1D%' OR email LIKE 'M1TEST%'`);
  const items = await pool.query(`SELECT COUNT(*) as c FROM owned_attire WHERE notes LIKE 'M1D%' OR notes LIKE 'M1TEST%'`);
  const trades = await pool.query(`SELECT COUNT(*) as c FROM trades WHERE note LIKE '%M1D%' OR note LIKE '%M1TEST%'`);
  const sessions = await pool.query(`SELECT COUNT(*) as c FROM sessions WHERE user_id IN (SELECT user_id FROM users WHERE email LIKE 'M1D%' OR email LIKE 'M1TEST%')`);

  console.log('Test data remaining:');
  console.log('  Users:', users.rows[0].c);
  console.log('  Items:', items.rows[0].c);
  console.log('  Trades:', trades.rows[0].c);
  console.log('  Sessions:', sessions.rows[0].c);
  
  await pool.end();
  
  const total = parseInt(users.rows[0].c) + parseInt(items.rows[0].c) + parseInt(trades.rows[0].c) + parseInt(sessions.rows[0].c);
  if (total === 0) {
    console.log('\n✓ All test data cleaned up');
  } else {
    console.log(`\n✗ ${total} test rows remaining`);
    process.exit(1);
  }
}

check();

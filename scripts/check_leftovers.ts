import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv();

const pool = new Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
});

async function main() {
  // Check verify-chat-% leftovers
  const chatUsers = await pool.query(`
    SELECT COUNT(*) as count FROM users WHERE email LIKE 'verify-chat-%@example.test'
  `);
  
  // Check verify-offers-% leftovers  
  const offersUsers = await pool.query(`
    SELECT COUNT(*) as count FROM users WHERE email LIKE 'verify-offers-%@example.test'
  `);
  
  console.log('LEFTOVER COUNTS:');
  console.log(`  verify-chat-%: ${chatUsers.rows[0].count} users`);
  console.log(`  verify-offers-%: ${offersUsers.rows[0].count} users`);
  console.log('');
  console.log('BASELINE (known from context):');
  console.log(`  verify-offers-%: 40 users, 3 listings (historical Oct 11-12)`);
  console.log(`  verify-chat-%: should be 0`);
  
  await pool.end();
}

main().catch(console.error);

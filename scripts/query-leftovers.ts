import { pool } from '../src/db';

async function main() {
  console.log('=== CHAT LEFTOVER COUNTS ===\n');
  
  const users = await pool.query(`SELECT COUNT(*) FROM users WHERE email LIKE 'verify-chat-%'`);
  console.log(`verify-chat users: ${users.rows[0].count}`);
  
  const threads = await pool.query(`
    SELECT COUNT(*) FROM chat_threads 
    WHERE thread_id IN (
      SELECT DISTINCT thread_id FROM chat_messages 
      WHERE sender_id IN (SELECT user_id FROM users WHERE email LIKE 'verify-chat-%')
    )
  `);
  console.log(`chat threads: ${threads.rows[0].count}`);
  
  const messages = await pool.query(`
    SELECT COUNT(*) FROM chat_messages 
    WHERE sender_id IN (SELECT user_id FROM users WHERE email LIKE 'verify-chat-%')
  `);
  console.log(`chat messages: ${messages.rows[0].count}`);
  
  await pool.end();
}

main().catch(console.error);

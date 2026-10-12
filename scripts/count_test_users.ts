import { pool } from '../src/db';

async function main() {
  const result = await pool.query(`
    SELECT COUNT(*) as count 
    FROM users 
    WHERE verification_status = 'verified' 
      AND (
        email LIKE '%.test' 
        OR email LIKE '%@example.com' 
        OR email LIKE 'test@%'
        OR email LIKE '%+test@%'
      )
  `);
  console.log('Verified test users count:', result.rows[0].count);
  process.exit(0);
}

main();

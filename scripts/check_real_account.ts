import { Pool } from 'pg';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  database: 'forgemind_dev',
  user: 'forgemind_app',
  password: 'master123456',
});

async function main() {
  try {
    const email = 'ahruy@gmail.com';
    const normalized = email.trim().toLowerCase();
    
    const userResult = await pool.query(
      'SELECT user_id, email, password_hash IS NOT NULL as has_password, verification_status FROM users WHERE LOWER(TRIM(email)) = $1',
      [normalized]
    );
    
    console.log(`User exists: ${userResult.rows.length > 0 ? 'yes' : 'no'}`);
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      console.log(`Stored email matches normalized: ${user.email === normalized ? 'yes' : 'no'}`);
      console.log(`Has password hash: ${user.has_password ? 'yes' : 'no'}`);
      console.log(`Verification status: ${user.verification_status}`);
      
      const statusResult = await pool.query(
        'SELECT banned_at IS NOT NULL as banned FROM marketplace_user_status WHERE user_id = $1',
        [user.user_id]
      );
      console.log(`Marketplace status row: ${statusResult.rows.length > 0 ? 'yes' : 'no'}`);
      if (statusResult.rows.length > 0) {
        console.log(`Marketplace banned: ${statusResult.rows[0].banned ? 'yes' : 'no'}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main();

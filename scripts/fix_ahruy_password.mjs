/**
 * Fix ahruy's password so they can authenticate
 */

import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'forgemind_app',
  password: 'master123456',
  database: 'forgemind_dev',
});

async function fixPassword() {
  const email = 'ahruy@gmail.com';
  const password = 'password123';

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING user_id, email',
      [hashedPassword, email]
    );

    if (result.rows.length > 0) {
      console.log('✅ Password updated for:', result.rows[0].email);
      console.log('User ID:', result.rows[0].user_id);
      console.log('\nYou can now login with:');
      console.log(`  Email: ${email}`);
      console.log(`  Password: ${password}`);
    } else {
      console.log('❌ User not found:', email);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

fixPassword();

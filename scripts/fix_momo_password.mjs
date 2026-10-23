/**
 * Fix momo@gmail.com password for testing
 * Sets password to: password123
 */

import pkg from 'pg';
const { Pool } = pkg;
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'forgemind_app',
  password: 'master123456',
  database: 'forgemind_dev',
});

async function main() {
  try {
    console.log('[fix_momo] Hashing password...');
    const password = 'password123';
    const hash = await bcrypt.hash(password, 10);
    
    console.log('[fix_momo] Updating momo@gmail.com password...');
    const result = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING user_id, email, marketplace_role, verification_status`,
      [hash, 'momo@gmail.com']
    );
    
    if (result.rows.length === 0) {
      console.error('[fix_momo] ❌ User momo@gmail.com not found!');
      process.exit(1);
    }
    
    const user = result.rows[0];
    console.log('[fix_momo] ✅ Password updated successfully');
    console.log('[fix_momo] User details:');
    console.log(`  - user_id: ${user.user_id}`);
    console.log(`  - email: ${user.email}`);
    console.log(`  - verification_status: ${user.verification_status}`);
    console.log(`  - marketplace_role: ${user.marketplace_role}`);
    console.log('');
    console.log('[fix_momo] You can now login with:');
    console.log('  Email: momo@gmail.com');
    console.log('  Password: password123');
    
    await pool.end();
  } catch (error) {
    console.error('[fix_momo] ❌ Error:', error.message);
    await pool.end();
    process.exit(1);
  }
}

main();

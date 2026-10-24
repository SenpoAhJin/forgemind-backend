/**
 * Check which migrations have been run
 */

import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://forgemind_app:forgemind_dev_pwd@127.0.0.1:5432/forgemind_dev',
});

async function checkMigrations() {
  try {
    console.log('📋 Checking migration status...\n');

    const result = await pool.query(`
      SELECT id, name, run_on 
      FROM pgmigrations 
      ORDER BY id DESC 
      LIMIT 10
    `);

    console.log(`✅ Last ${result.rows.length} migrations run:\n`);
    result.rows.forEach(m => {
      console.log(`  ${String(m.id).padStart(3, ' ')}. ${m.name.padEnd(40)} - ${new Date(m.run_on).toLocaleString()}`);
    });

    // Check if migration 026 exists
    const check026 = await pool.query(`
      SELECT * FROM pgmigrations WHERE name = '026-offer-two-party-confirmation'
    `);

    console.log('\n');
    if (check026.rows.length > 0) {
      console.log('✅ Migration 026 (offer two-party confirmation) HAS been run!');
    } else {
      console.log('⚠️  Migration 026 (offer two-party confirmation) has NOT been run yet.');
      console.log('   Run: npm run migrate');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkMigrations();

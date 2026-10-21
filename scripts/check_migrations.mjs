#!/usr/bin/env node
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function checkMigrations() {
  try {
    // List all migrations
    const migrations = await pool.query(
      'SELECT id, name FROM pgmigrations ORDER BY id'
    );
    
    console.log('Applied migrations:');
    migrations.rows.forEach(row => {
      console.log(`  ${row.id}: ${row.name}`);
    });
    
    // Check if 021 is present
    const has021 = migrations.rows.some(r => r.name.includes('021_m1_trade_system'));
    console.log(`\n021_m1_trade_system: ${has021 ? 'PRESENT' : 'MISSING'}`);
    
    // Check if 022 is present
    const has022 = migrations.rows.filter(r => r.name.includes('022')).length;
    console.log(`022 migrations: ${has022} found`);
    
    // Check tables exist
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('app_settings', 'trades', 'trade_items', 'trade_events', 'item_ownership_history')
      ORDER BY table_name
    `);
    
    console.log('\nTrade tables:');
    tables.rows.forEach(row => {
      console.log(`  ✓ ${row.table_name}`);
    });
    
    // Check settings exist
    const settings = await pool.query(`
      SELECT key FROM app_settings WHERE key LIKE 'trade.%' OR key LIKE 'settings.%' ORDER BY key
    `);
    
    console.log('\nTrade settings:');
    settings.rows.forEach(row => {
      console.log(`  ✓ ${row.key}`);
    });
    
    // Check owned_attire constraint
    const constraint = await pool.query(`
      SELECT con.conname, pg_get_constraintdef(con.oid) as definition
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      WHERE rel.relname = 'owned_attire' 
        AND con.conname LIKE '%availability_status%'
    `);
    
    console.log('\nowned_attire availability_status constraint:');
    if (constraint.rows.length > 0) {
      console.log(`  ${constraint.rows[0].definition}`);
    } else {
      console.log('  NOT FOUND');
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkMigrations();

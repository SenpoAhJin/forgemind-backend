/**
 * Test script to check offer accept/decline functionality
 */

import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'forgemind_app',
  password: 'master123456',
  database: 'forgemind_dev',
});

async function test() {
  try {
    console.log('Testing offer accept/decline...\n');

    // Check if structured_offers table exists
    const tableCheck = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'structured_offers'
    `);
    
    console.log('structured_offers table exists:', tableCheck.rows.length > 0);

    if (tableCheck.rows.length === 0) {
      console.log('\n❌ ERROR: structured_offers table does NOT exist!');
      console.log('This is the root cause of the accept/decline errors.');
      console.log('\nSolution: Run the migration that creates structured_offers table.');
      return;
    }

    // Check table structure
    const columnsCheck = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'structured_offers'
      ORDER BY ordinal_position
    `);
    
    console.log('\nstructured_offers columns:');
    columnsCheck.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    // Check if there are any offers
    const offersCheck = await pool.query('SELECT COUNT(*) FROM structured_offers');
    console.log(`\nTotal offers in database: ${offersCheck.rows[0].count}`);

    // Check pending offers
    const pendingCheck = await pool.query(`
      SELECT offer_id, listing_id, proposer_user_id, offer_type, status 
      FROM structured_offers 
      WHERE status = 'pending'
      LIMIT 5
    `);
    
    console.log(`\nPending offers: ${pendingCheck.rows.length}`);
    if (pendingCheck.rows.length > 0) {
      console.log('Sample pending offers:');
      pendingCheck.rows.forEach(offer => {
        console.log(`  - ${offer.offer_id}: ${offer.offer_type} (${offer.status})`);
      });
    }

    console.log('\n✅ Database structure looks correct for offer actions.');

  } catch (error) {
    console.error('❌ Error during test:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

test();

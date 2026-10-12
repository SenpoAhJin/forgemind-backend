import { pool } from '../src/db';

async function main() {
  const result = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) 
    FROM pg_constraint 
    WHERE conname = 'listings_listing_status_check'
  `);
  console.log('Constraint:', result.rows[0]?.pg_get_constraintdef || 'NOT FOUND');
  process.exit(0);
}

main();

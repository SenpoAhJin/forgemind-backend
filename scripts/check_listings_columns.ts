import { pool } from '../src/db';

async function main() {
  const r = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'listings' 
    ORDER BY ordinal_position
  `);
  console.log('listings table columns:');
  r.rows.forEach(row => {
    console.log(`  - ${row.column_name}: ${row.data_type}`);
  });
  await pool.end();
}

main().catch(console.error);

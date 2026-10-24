import { pool } from '../src/db';

async function main() {
  const r = await pool.query(`
    SELECT conname, pg_get_constraintdef(oid) as definition 
    FROM pg_constraint 
    WHERE conname = 'listings_transaction_type_check'
  `);
  console.log(r.rows[0].definition);
  await pool.end();
}

main().catch(console.error);

import { pool } from '../src/db';

async function main() {
  const result = await pool.query(
    "SELECT indexdef FROM pg_indexes WHERE tablename = 'structured_offers' AND indexname = 'idx_unique_pending_offer'"
  );
  console.log(result.rows[0]?.indexdef || 'NOT FOUND');
  process.exit(0);
}

main();

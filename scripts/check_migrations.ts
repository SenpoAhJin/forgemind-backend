import { pool } from '../src/db';

async function main() {
  const r = await pool.query('SELECT id, name FROM pgmigrations ORDER BY id DESC LIMIT 5');
  console.log('Latest migrations:');
  r.rows.forEach(row => console.log(`  ${row.id}: ${row.name}`));
  await pool.end();
}

main().catch(console.error);

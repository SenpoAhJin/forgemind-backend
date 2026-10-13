import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';

loadEnv();

const pool = new Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
});

async function main() {
  const result = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'chat_messages'
    ORDER BY ordinal_position
  `);
  
  console.log('chat_messages columns:');
  result.rows.forEach(row => {
    console.log(`  ${row.column_name}: ${row.data_type}`);
  });
  
  await pool.end();
}

main().catch(console.error);

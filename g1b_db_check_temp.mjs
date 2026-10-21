// G1B DB verification - read-only checks
import pg from 'pg';
import { config } from 'dotenv';

config();

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
  max: 1,
});

async function check() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    
    // Basic connectivity
    const version = await client.query('SELECT version()');
    console.log('DB_CONNECTED=true');
    console.log('PG_VERSION=' + version.rows[0].version.split(' ')[1]);
    
    // Table count
    const tables = await client.query(`
      SELECT COUNT(*) as cnt 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `);
    console.log('TABLE_COUNT=' + tables.rows[0].cnt);
    
    // Sample tables
    const tableNames = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
      LIMIT 10
    `);
    console.log('SAMPLE_TABLES=' + tableNames.rows.map(r => r.table_name).join(','));
    
    // Check listen_addresses
    const listen = await client.query("SHOW listen_addresses");
    console.log('PG_LISTEN_ADDRESSES=' + listen.rows[0].listen_addresses);
    
    await client.query('COMMIT');
  } catch (err) {
    console.error('DB_ERROR_CODE=' + (err.code || 'UNKNOWN'));
    console.error('DB_ERROR_MESSAGE=' + err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

check().catch(err => {
  console.error('SCRIPT_ERROR=' + err.message);
  process.exit(1);
});

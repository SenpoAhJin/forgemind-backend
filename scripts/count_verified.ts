import { query } from '../src/db';

async function main() {
  const result = await query<{ count: string }>('SELECT COUNT(*) as count FROM users WHERE verification_status = $1', ['verified']);
  console.log('Verified users count:', result[0].count);
  process.exit(0);
}

main();

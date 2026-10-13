import { pool } from '../src/db';

async function main() {
  console.log('=== VERIFY-OFFERS LEFTOVERS ANALYSIS ===\n');
  
  // Users by date
  const usersResult = await pool.query(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM users
    WHERE email LIKE 'verify-offers-%'
    GROUP BY DATE(created_at)
    ORDER BY date
  `);
  
  console.log('Users with email LIKE verify-offers-%:');
  for (const row of usersResult.rows) {
    console.log(`  ${row.date}: ${row.count} users`);
  }
  const totalUsers = usersResult.rows.reduce((sum: number, r: any) => sum + parseInt(r.count), 0);
  console.log(`  Total: ${totalUsers}\n`);
  
  // Listings count (by seller_user_id)
  const listingsResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM listings l
    JOIN users u ON l.seller_user_id = u.user_id
    WHERE u.email LIKE 'verify-offers-%'
  `);
  
  console.log(`Listings owned by verify-offers-% users: ${listingsResult.rows[0].count}\n`);
  
  // Offers count
  const offersResult = await pool.query(`
    SELECT COUNT(*) as count
    FROM structured_offers so
    JOIN listings l ON so.listing_id = l.listing_id
    JOIN users u ON l.seller_user_id = u.user_id
    WHERE u.email LIKE 'verify-offers-%'
  `);
  
  console.log(`Offers for those listings: ${offersResult.rows[0].count}\n`);
  
  await pool.end();
}

main().catch(console.error);

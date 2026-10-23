/**
 * Test decline endpoint and create a fresh scenario for testing accept
 */

import pg from 'pg';

const { Pool } = pg;

const API_BASE = 'http://localhost:3000';

const pool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'forgemind_app',
  password: 'master123456',
  database: 'forgemind_dev',
});

async function test() {
  try {
    console.log('Testing DECLINE and Creating Fresh Accept Scenario\n');
    console.log('==================================================\n');

    // Step 1: Login as ahruy (seller)
    console.log('Step 1: Logging in as ahruy@gmail.com...');
    const loginResponse = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'ahruy@gmail.com',
        password: 'password123'
      })
    });

    if (!loginResponse.ok) {
      console.log('❌ Login failed');
      return;
    }

    const loginData = await loginResponse.json();
    const token = loginData.session_token;
    console.log('✅ Login successful\n');

    // Step 2: Get the pending offer
    const pendingOfferId = '41be83d0-3008-492c-af57-c7b8629c3f1f';
    
    console.log('Step 2: Testing DECLINE endpoint...');
    const declineResponse = await fetch(`${API_BASE}/marketplace/offers/${pendingOfferId}/decline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    console.log('Decline Response Status:', declineResponse.status);
    const declineText = await declineResponse.text();
    
    if (!declineResponse.ok) {
      console.log('❌ Decline failed:');
      console.log('Response:', declineText);
    } else {
      console.log('✅ Decline successful!');
      const data = JSON.parse(declineText);
      console.log('New status:', data.status);
    }

    // Verify in database
    console.log('\nStep 3: Verifying in database...');
    const offerCheck = await pool.query(
      'SELECT offer_id, status, responded_at FROM structured_offers WHERE offer_id = $1',
      [pendingOfferId]
    );
    
    if (offerCheck.rows.length > 0) {
      const updated = offerCheck.rows[0];
      console.log('Database status:', updated.status);
      console.log('Responded at:', updated.responded_at);
      
      if (updated.status === 'declined') {
        console.log('✅ Offer successfully declined in database!');
      } else {
        console.log('⚠️  Offer status in database:', updated.status);
      }
    }

    // Step 4: Find or create a listing with NO accepted offers for testing accept
    console.log('\n\nStep 4: Finding listing WITHOUT accepted offers for testing accept...');
    
    const listingsWithoutAcceptedOffers = await pool.query(`
      SELECT l.listing_id, l.item_title, l.seller_user_id, l.listing_status
      FROM listings l
      WHERE l.listing_status = 'active'
        AND l.seller_user_id = '05fef81e-f006-4936-9570-125f1acc5f6f'
        AND NOT EXISTS (
          SELECT 1 FROM structured_offers o 
          WHERE o.listing_id = l.listing_id 
            AND o.status = 'accepted'
        )
      LIMIT 1
    `);

    if (listingsWithoutAcceptedOffers.rows.length > 0) {
      const testListing = listingsWithoutAcceptedOffers.rows[0];
      console.log('✅ Found listing without accepted offers:');
      console.log(`  - ID: ${testListing.listing_id}`);
      console.log(`  - Title: ${testListing.item_title}`);
      console.log(`  - Status: ${testListing.listing_status}`);
      
      // Check if there are any pending offers on this listing
      const pendingOffersOnListing = await pool.query(
        `SELECT offer_id, offer_type, status FROM structured_offers WHERE listing_id = $1 AND status = 'pending'`,
        [testListing.listing_id]
      );
      
      console.log(`\n  Pending offers on this listing: ${pendingOffersOnListing.rows.length}`);
      
      if (pendingOffersOnListing.rows.length > 0) {
        console.log('\n✅ TEST SCENARIO: You can test ACCEPT with these offers:');
        pendingOffersOnListing.rows.forEach(offer => {
          console.log(`  - Offer ID: ${offer.offer_id}`);
          console.log(`    Type: ${offer.offer_type}, Status: ${offer.status}`);
        });
      } else {
        console.log('\n⚠️  No pending offers on this listing. Create an offer first to test accept.');
      }
    } else {
      console.log('❌ No active listings found without accepted offers for ahruy@gmail.com');
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

test();

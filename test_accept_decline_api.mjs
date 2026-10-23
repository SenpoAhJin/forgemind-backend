/**
 * Test script to check offer accept/decline API endpoints
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
    console.log('Testing Offer Accept/Decline API Endpoints\n');
    console.log('==========================================\n');

    // Step 1: Login as ahruy (seller of the pending offer)
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
      console.log('❌ Login failed:', loginResponse.status, await loginResponse.text());
      return;
    }

    const loginData = await loginResponse.json();
    const token = loginData.session_token;
    
    if (!token) {
      console.log('❌ No token in login response:', JSON.stringify(loginData, null, 2));
      return;
    }
    
    console.log('✅ Login successful, token:', token.substring(0, 20) + '...\n');

    // Step 2: Get received offers
    console.log('Step 2: Fetching received offers...');
    const receivedResponse = await fetch(`${API_BASE}/marketplace/offers/received`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!receivedResponse.ok) {
      console.log('❌ Fetch received offers failed:', receivedResponse.status, await receivedResponse.text());
      return;
    }

    const receivedData = await receivedResponse.json();
    console.log(`✅ Found ${receivedData.offers.length} received offers\n`);

    // Find a pending offer
    const pendingOffer = receivedData.offers.find(o => o.status === 'pending');
    
    if (!pendingOffer) {
      console.log('⚠️  No pending offers found. Cannot test accept/decline.');
      console.log('Offers:', receivedData.offers.map(o => ({ id: o.offer_id, status: o.status })));
      return;
    }

    console.log('Found pending offer to test:');
    console.log(`  - ID: ${pendingOffer.offer_id}`);
    console.log(`  - Type: ${pendingOffer.offer_type}`);
    console.log(`  - Listing: ${pendingOffer.listing_title}`);
    console.log(`  - From: ${pendingOffer.proposer_display_name}\n`);

    // Step 3: Try to accept the offer
    console.log('Step 3: Testing ACCEPT endpoint...');
    const acceptResponse = await fetch(`${API_BASE}/marketplace/offers/${pendingOffer.offer_id}/accept`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    console.log('Accept Response Status:', acceptResponse.status);
    const acceptText = await acceptResponse.text();
    
    if (!acceptResponse.ok) {
      console.log('❌ Accept failed:');
      console.log('Response:', acceptText);
      
      // Parse error if JSON
      try {
        const errorData = JSON.parse(acceptText);
        console.log('\nError details:');
        console.log('  - error:', errorData.error);
        console.log('  - message:', errorData.message);
      } catch (e) {
        // Not JSON
      }
    } else {
      console.log('✅ Accept successful!');
      console.log('Response:', acceptText);
    }

    // Verify in database
    console.log('\nStep 4: Verifying in database...');
    const offerCheck = await pool.query(
      'SELECT offer_id, status, responded_at FROM structured_offers WHERE offer_id = $1',
      [pendingOffer.offer_id]
    );
    
    if (offerCheck.rows.length > 0) {
      const updated = offerCheck.rows[0];
      console.log('Database status:', updated.status);
      console.log('Responded at:', updated.responded_at);
      
      if (updated.status === 'accepted') {
        console.log('✅ Offer successfully accepted in database!');
      } else {
        console.log('⚠️  Offer status in database:', updated.status);
      }
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

test();

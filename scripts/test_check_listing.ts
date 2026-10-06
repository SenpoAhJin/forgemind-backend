/**
 * Test /marketplace/listings/check endpoint with synthetic listings
 * Reproduces TASK POPUP issues:
 * - Listing A: "Can't check your listing right now" error
 * - Listing B: HTTP 400 validation error
 */

const API_BASE = 'http://localhost:3000';

// Test credentials - use existing account or create new one
const TEST_EMAIL = 'popup-test@example.com';
const TEST_PASSWORD = 'TestPass123!';

// Test cases from TASK POPUP description
const LISTING_A = {
  title: 'Luck Voltia wig from Black Clover',
  description: 'pre-Timeskip appearance whole set with wig',
  category: 'Costumes & Cosplay',
};

const LISTING_B = {
  title: 'Sample listing title',
  description: 'Sample listing description',
  category: 'Costumes & Cosplay',
};

async function getAuthToken(): Promise<string | null> {
  try {
    // Try to register
    const regResp = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Popup Test User',
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        phone: '+639123456789',
        display_name: 'PopupTest',
        base_body_selection: 'female',
      }),
    });

    const regText = await regResp.text();
    console.log(`Registration: ${regResp.status}`, regText.substring(0, 200));

    // Login regardless of registration outcome (might already exist)
    const loginResp = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });

    if (!loginResp.ok) {
      const loginText = await loginResp.text();
      console.error(`Login failed: ${loginResp.status}`, loginText);
      return null;
    }

    const loginData: any = await loginResp.json();
    const token = loginData.session_token;

    // Submit marketplace registration
    const mktRegResp = await fetch(`${API_BASE}/marketplace/registration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        marketplace_role: 'seller',
        seller_display_name: 'PopupTest Shop',
        marketplace_contact_email: 'popup@test.com',
        marketplace_contact_phone: '09171234567',
        payout_method_label: 'Test payout',
        payout_method_number: '12345678',
        agreed_to_marketplace_terms: true,
      }),
    });

    const mktRegText = await mktRegResp.text();
    console.log(`Marketplace registration: ${mktRegResp.status}`, mktRegText.substring(0, 200));

    return token;
  } catch (error) {
    console.error(`Auth error:`, error);
    return null;
  }
}

async function testCheckListing(name: string, listing: { title: string; description: string; category: string }, token: string) {
  console.log(`\n=== Testing ${name} ===`);
  console.log(`Title: "${listing.title}"`);
  console.log(`Description: "${listing.description}"`);
  console.log(`Category: "${listing.category}"`);

  try {
    const response = await fetch(`${API_BASE}/marketplace/listings/check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(listing),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);
    
    const text = await response.text();
    console.log(`Response body: ${text}`);

    try {
      const json = JSON.parse(text);
      console.log(`Parsed JSON:`, JSON.stringify(json, null, 2));
    } catch {
      console.log(`(Not valid JSON)`);
    }
  } catch (error) {
    console.error(`Network error:`, error);
  }
}

async function main() {
  console.log('Testing /marketplace/listings/check endpoint');
  console.log('===========================================');

  console.log('\n=== Authenticating ===');
  const token = await getAuthToken();
  if (!token) {
    console.error('Failed to get auth token');
    return;
  }
  console.log('Auth token obtained');

  // Now need to manually approve marketplace registration - can't do via API, must use psql
  console.log('\n!! MANUAL STEP REQUIRED !!');
  console.log(`Run this SQL to approve the account:\nUPDATE users SET verification_status = 'verified' WHERE email = '${TEST_EMAIL}';\n`);

  await testCheckListing('Listing A', LISTING_A, token);
  await testCheckListing('Listing B', LISTING_B, token);

  console.log('\n=== Done ===');
}

main().catch(console.error);

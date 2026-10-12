/**
 * Self-contained verification script for marketplace offers endpoints
 *
 * Creates throwaway test users and listings, runs all tests, then cleans up.
 * Never uses or modifies real accounts.
 */

import { pool } from '../src/db';

const API_BASE = 'http://localhost:3000';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];
const createdUserIds: string[] = [];
const createdListingIds: string[] = [];
const createdOfferIds: string[] = [];

function pass(name: string) {
  results.push({ name, passed: true });
  console.log(`✓ ${name}`);
}

function fail(name: string, error: string) {
  results.push({ name, passed: false, error });
  console.error(`✗ ${name}: ${error}`);
}

async function apiCall(
  method: string,
  path: string,
  token?: string,
  body?: any,
): Promise<{ status: number; data: any }> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: any = null;
  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    data = await res.json();
  }

  return { status: res.status, data };
}

async function createTestUser(role: 'buyer' | 'seller' | 'both', verified: boolean): Promise<{ userId: string; email: string; token: string } | null> {
  const rand = Math.random().toString(36).substr(2, 9);
  const email = `verify-offers-${rand}@example.test`;
  const password = 'test123456';
  const displayName = `Test User ${rand}`;

  // Register via API (handles password hashing correctly)
  const registerBody = {
    email,
    password,
    display_name: displayName,
    is_cosplayer: true,
    base_body_selection: 'female',
  };

  const registerRes = await apiCall('POST', '/auth/register', undefined, registerBody);
  if (registerRes.status !== 201 || !registerRes.data?.user?.user_id) {
    console.error(`Failed to register test user: ${email}`, registerRes);
    return null;
  }

  const userId = registerRes.data.user.user_id;
  createdUserIds.push(userId);

  // Update marketplace fields and verification status directly
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE users SET 
         marketplace_role = $1,
         verification_status = $2,
         seller_display_name = $3,
         marketplace_contact_email = $4,
         payout_method_label = $5,
         payout_method_number = $6,
         agreed_to_marketplace_terms = $7,
         data_consent_given = true
       WHERE user_id = $8`,
      [
        role,
        verified ? 'verified' : 'pending',
        role !== 'buyer' ? displayName : null,
        role !== 'buyer' ? email : null,
        role !== 'buyer' ? 'Test Payout' : null,
        role !== 'buyer' ? '1234567890' : null,
        role !== 'buyer',
        userId,
      ],
    );

    // Create marketplace_user_status
    await client.query(
      'INSERT INTO marketplace_user_status (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
      [userId],
    );
  } finally {
    client.release();
  }

  // Login to get session token
  const loginRes = await apiCall('POST', '/auth/login', undefined, { email, password });
  if (loginRes.status !== 200 || !loginRes.data.session_token) {
    console.error(`Failed to login test user: ${email}`, loginRes);
    return null;
  }

  return { userId, email, token: loginRes.data.session_token };
}

async function createTestListing(token: string, category: string, title: string, description: string, postType: 'sell' | 'trade' | 'commission' = 'sell'): Promise<string | null> {
  const body: any = {
    title,
    description,
    category,
    post_type: postType,
    photo_ids: [],
  };

  if (postType === 'sell') {
    body.price = 100;
    body.condition = 'new';
  } else if (postType === 'commission') {
    body.rate = 500;
    body.timeline = '2-4 weeks';
  }

  const { status, data } = await apiCall('POST', '/marketplace/listings', token, body);

  if (status === 201 && data.listing?.id) {
    createdListingIds.push(data.listing.id);
    return data.listing.id;
  }
  
  console.error(`Failed to create listing "${title}":`, { status, data });
  return null;
}

async function cleanup() {
  console.log('\n=== CLEANUP ===');
  const client = await pool.connect();
  try {
    // Delete offers (CASCADE will handle transaction_milestones)
    if (createdOfferIds.length > 0) {
      const offerResult = await client.query(
        'DELETE FROM structured_offers WHERE offer_id = ANY($1::uuid[])',
        [createdOfferIds],
      );
      console.log(`Deleted ${offerResult.rowCount} offers`);
    }

    // Delete listings (CASCADE will handle offers if any remain)
    if (createdListingIds.length > 0) {
      const listingResult = await client.query(
        'DELETE FROM listings WHERE listing_id = ANY($1::uuid[])',
        [createdListingIds],
      );
      console.log(`Deleted ${listingResult.rowCount} listings`);
    }

    // Delete users (CASCADE will handle sessions, marketplace_user_status, etc)
    if (createdUserIds.length > 0) {
      const userResult = await client.query(
        'DELETE FROM users WHERE user_id = ANY($1::uuid[])',
        [createdUserIds],
      );
      console.log(`Deleted ${userResult.rowCount} users`);
    }

    // Verify cleanup
    const offerCount = await client.query(
      'SELECT COUNT(*) FROM structured_offers WHERE offer_id = ANY($1::uuid[])',
      [createdOfferIds.length > 0 ? createdOfferIds : ['00000000-0000-0000-0000-000000000000']],
    );
    const listingCount = await client.query(
      'SELECT COUNT(*) FROM listings WHERE listing_id = ANY($1::uuid[])',
      [createdListingIds.length > 0 ? createdListingIds : ['00000000-0000-0000-0000-000000000000']],
    );
    const userCount = await client.query(
      'SELECT COUNT(*) FROM users WHERE user_id = ANY($1::uuid[])',
      [createdUserIds.length > 0 ? createdUserIds : ['00000000-0000-0000-0000-000000000000']],
    );

    console.log(`Leftover offers: ${offerCount.rows[0].count}`);
    console.log(`Leftover listings: ${listingCount.rows[0].count}`);
    console.log(`Leftover users: ${userCount.rows[0].count}`);

    if (parseInt(offerCount.rows[0].count) > 0 || parseInt(listingCount.rows[0].count) > 0 || parseInt(userCount.rows[0].count) > 0) {
      console.error('WARNING: Cleanup incomplete! Leftover test data found.');
    } else {
      console.log('✓ Cleanup verified: all test data removed');
    }
  } finally {
    client.release();
  }
}

async function runTests() {
  console.log('=== Marketplace Offers Verification (Self-Contained) ===\n');

  try {
    // Setup: Create test users
    console.log('Setup: Creating test users...');
    const seller = await createTestUser('seller', true);
    const seller2 = await createTestUser('seller', true);
    const buyer = await createTestUser('buyer', true);
    const unverified = await createTestUser('buyer', false);

    if (!seller || !seller2 || !buyer || !unverified) {
      console.error('FATAL: Could not create test users');
      process.exit(1);
    }

    console.log(`✓ Created verified seller: ${seller.userId}`);
    console.log(`✓ Created verified seller2: ${seller2.userId}`);
    console.log(`✓ Created verified buyer: ${buyer.userId}`);
    console.log(`✓ Created unverified user: ${unverified.userId}\n`);

    // Create test listings
    console.log('Setup: Creating test listings...');
    const listingCostume = await createTestListing(
      seller.token,
      'Costumes & Cosplay',
      'Beautiful handmade Sakura costume with accessories',
      'This beautiful costume was carefully made with high quality materials and includes all the accessories you need for your next event. The outfit features detailed stitching and accurate colors that will make you stand out at any convention.',
      'sell'
    );
    const listingPhotography = await createTestListing(
      seller.token,
      'Photography Services',
      'Professional photo shoot for cosplayers',
      'Looking to capture your amazing cosplay? I offer professional photography services with high resolution images and quick turnaround. Perfect for portfolio building or sharing your favorite characters online.',
      'commission'
    );
    const listingCustom = await createTestListing(
      seller.token,
      'Commissions & Crafting Services',
      'Custom costume creation and tailoring',
      'Let me bring your dream cosplay to life! I specialize in creating custom costumes from your favorite anime and games. Every piece is made to measure and crafted with attention to detail.',
      'commission'
    );

    if (!listingCostume || !listingPhotography || !listingCustom) {
      console.error('FATAL: Could not create test listings');
      process.exit(1);
    }

    console.log(`✓ Created costume listing: ${listingCostume}`);
    console.log(`✓ Created photography listing: ${listingPhotography}`);
    console.log(`✓ Created custom listing: ${listingCustom}\n`);

    // Test 1: Unverified user cannot create offer
    {
      const { status } = await apiCall('POST', '/marketplace/offers', unverified.token, {
        listing_id: listingCostume,
        offer_type: 'purchase',
        offered_price: 90,
      });
      if (status === 403) {
        pass('T1: Unverified user denied (403)');
      } else {
        fail('T1: Unverified user denied', `Expected 403, got ${status}`);
      }
    }

    // Test 2: Cannot offer on non-existent listing
    {
      const { status } = await apiCall('POST', '/marketplace/offers', buyer.token, {
        listing_id: '00000000-0000-0000-0000-000000000000',
        offer_type: 'purchase',
        offered_price: 90,
      });
      if (status === 404) {
        pass('T2: Non-existent listing rejected (404)');
      } else {
        fail('T2: Non-existent listing rejected', `Expected 404, got ${status}`);
      }
    }

    // Test 3: Cannot offer on own listing
    {
      const { status } = await apiCall('POST', '/marketplace/offers', seller.token, {
        listing_id: listingCostume,
        offer_type: 'purchase',
        offered_price: 90,
      });
      if (status === 400) {
        pass('T3: Own listing rejected (400)');
      } else {
        fail('T3: Own listing rejected', `Expected 400, got ${status}`);
      }
    }

    // Test 4: Offer type not allowed for category
    {
      const { status } = await apiCall('POST', '/marketplace/offers', buyer.token, {
        listing_id: listingPhotography,
        offer_type: 'trade',
        trade_offered_item: 'Test item',
      });
      if (status === 400) {
        pass('T4: Wrong offer type for category rejected (400)');
      } else {
        fail('T4: Wrong offer type for category rejected', `Expected 400, got ${status}`);
      }
    }

    // Test 5: Valid purchase offer
    let offer1Id: string | null = null;
    {
      const { status, data } = await apiCall('POST', '/marketplace/offers', buyer.token, {
        listing_id: listingCostume,
        offer_type: 'purchase',
        offered_price: 90,
      });
      if (status === 201 && data.offer_id) {
        offer1Id = data.offer_id;
        createdOfferIds.push(offer1Id);
        pass('T5: Valid purchase offer created (201)');
      } else {
        fail('T5: Valid purchase offer created', `Expected 201, got ${status}`);
      }
    }

    // Test 6: Duplicate pending offer rejected
    {
      const { status } = await apiCall('POST', '/marketplace/offers', buyer.token, {
        listing_id: listingCostume,
        offer_type: 'purchase',
        offered_price: 95,
      });
      if (status === 409) {
        pass('T6: Duplicate pending offer rejected (409)');
      } else {
        fail('T6: Duplicate pending offer rejected', `Expected 409, got ${status}`);
      }
    }

    // Test 7: Valid trade offer
    let offer2Id: string | null = null;
    {
      const { status, data } = await apiCall('POST', '/marketplace/offers', seller2.token, {
        listing_id: listingCostume,
        offer_type: 'trade',
        trade_offered_item: 'Wig',
        trade_offered_condition: 'good',
        trade_offered_est_value: 80,
      });
      if (status === 201 && data.offer_id) {
        offer2Id = data.offer_id;
        createdOfferIds.push(offer2Id);
        pass('T7: Valid trade offer created (201)');
      } else {
        fail('T7: Valid trade offer created', `Expected 201, got ${status}`);
      }
    }

    // Test 8: Valid commission offer
    let commissionOfferId: string | null = null;
    {
      const { status, data } = await apiCall('POST', '/marketplace/offers', buyer.token, {
        listing_id: listingCustom,
        offer_type: 'commission',
        commission_description: 'Make a Spiderman costume',
        timeline_days: 30,
        offered_price: 500,
      });
      if (status === 201 && data.offer_id) {
        commissionOfferId = data.offer_id;
        createdOfferIds.push(commissionOfferId);
        pass('T8: Valid commission offer created (201)');
      } else {
        fail('T8: Valid commission offer created', `Expected 201, got ${status}`);
      }
    }

    // Test 9: Seller accepts first offer
    if (offer1Id) {
      const { status, data } = await apiCall('POST', `/marketplace/offers/${offer1Id}/accept`, seller.token);
      if (status === 200 && data.status === 'accepted') {
        pass('T9: Seller accepts offer (200, status=accepted)');
      } else {
        fail('T9: Seller accepts offer', `Expected 200 with accepted, got ${status}`);
      }
    }

    // Test 10: Cannot accept second purchase/trade offer (transaction lock test)
    if (offer2Id) {
      const { status } = await apiCall('POST', `/marketplace/offers/${offer2Id}/accept`, seller.token);
      if (status === 409) {
        pass('T10: Second purchase/trade offer blocked by transaction (409)');
      } else {
        fail('T10: Second purchase/trade offer blocked', `Expected 409, got ${status}`);
      }
    }

    // Test 11: Multiple commission offers allowed
    let commission2Id: string | null = null;
    {
      const { status, data } = await apiCall('POST', '/marketplace/offers', seller2.token, {
        listing_id: listingCustom,
        offer_type: 'commission',
        commission_description: 'Make a Batman costume',
        timeline_days: 45,
        offered_price: 600,
      });
      if (status === 201 && data.offer_id) {
        commission2Id = data.offer_id;
        createdOfferIds.push(commission2Id);
      }
    }

    if (commissionOfferId && commission2Id) {
      // Accept first commission
      await apiCall('POST', `/marketplace/offers/${commissionOfferId}/accept`, seller.token);

      // Accept second commission
      const { status } = await apiCall('POST', `/marketplace/offers/${commission2Id}/accept`, seller.token);
      if (status === 200) {
        pass('T11: Multiple commission offers allowed (200)');
      } else {
        fail('T11: Multiple commission offers allowed', `Expected 200, got ${status}`);
      }
    } else {
      fail('T11: Multiple commission offers allowed', 'Setup failed');
    }

    // Test 12: Concurrency test - two offers from same user at same time
    {
      const listing2 = await createTestListing(
        seller.token,
        'Costumes & Cosplay',
        'Amazing red and black costume for sale',
        'Wonderful costume in excellent condition with everything you need included in the package',
        'sell'
      );
      if (listing2) {
        const promises = [
          apiCall('POST', '/marketplace/offers', buyer.token, {
            listing_id: listing2,
            offer_type: 'purchase',
            offered_price: 100,
          }),
          apiCall('POST', '/marketplace/offers', buyer.token, {
            listing_id: listing2,
            offer_type: 'purchase',
            offered_price: 110,
          }),
        ];

        const results = await Promise.all(promises);
        const successCount = results.filter(r => r.status === 201).length;
        const conflictCount = results.filter(r => r.status === 409).length;

        if (successCount === 1 && conflictCount === 1) {
          pass('T12: Concurrent offers from same user (1 success, 1 conflict)');
        } else {
          fail('T12: Concurrent offers from same user', `Expected 1 success + 1 conflict, got ${successCount} success, ${conflictCount} conflict`);
        }

        // Track created offer
        results.forEach(r => {
          if (r.status === 201 && r.data.offer_id) {
            createdOfferIds.push(r.data.offer_id);
          }
        });
      }
    }

    // Test 13: Concurrency test - two accepts on same purchase listing
    {
      const listing3 = await createTestListing(
        seller.token,
        'Costumes & Cosplay',
        'Elegant blue costume with matching accessories',
        'Beautiful costume perfect for your next convention or photo shoot with great attention to detail',
        'sell'
      );
      if (listing3) {
        // Create two offers from different users
        const offer1Res = await apiCall('POST', '/marketplace/offers', buyer.token, {
          listing_id: listing3,
          offer_type: 'purchase',
          offered_price: 90,
        });
        const offer2Res = await apiCall('POST', '/marketplace/offers', seller2.token, {
          listing_id: listing3,
          offer_type: 'purchase',
          offered_price: 95,
        });

        if (offer1Res.status === 201 && offer2Res.status === 201) {
          const offerId1 = offer1Res.data.offer_id;
          const offerId2 = offer2Res.data.offer_id;
          createdOfferIds.push(offerId1, offerId2);

          // Try to accept both simultaneously
          const acceptPromises = [
            apiCall('POST', `/marketplace/offers/${offerId1}/accept`, seller.token),
            apiCall('POST', `/marketplace/offers/${offerId2}/accept`, seller.token),
          ];

          const acceptResults = await Promise.all(acceptPromises);
          const acceptSuccessCount = acceptResults.filter(r => r.status === 200).length;
          const acceptConflictCount = acceptResults.filter(r => r.status === 409).length;

          if (acceptSuccessCount === 1 && acceptConflictCount === 1) {
            pass('T13: Concurrent accepts on purchase listing (1 success, 1 conflict)');
          } else {
            fail('T13: Concurrent accepts on purchase listing', `Expected 1 success + 1 conflict, got ${acceptSuccessCount} success, ${acceptConflictCount} conflict`);
          }
        } else {
          fail('T13: Concurrent accepts on purchase listing', 'Setup failed');
        }
      }
    }

    // Summary
    console.log('\n=== SUMMARY ===');
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    console.log(`${passed}/${total} tests passed`);

    if (passed < total) {
      console.log('\nFailed tests:');
      results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    } else {
      console.log('\n✓ All tests passed!');
    }

  } finally {
    await cleanup();
    await pool.end();
  }

  if (results.filter(r => !r.passed).length > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('FATAL ERROR:', err);
  cleanup().then(() => pool.end()).finally(() => process.exit(1));
});

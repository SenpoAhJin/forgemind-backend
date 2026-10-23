/**
 * Test script to debug listing creation 400 error
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
    console.log('Testing Create Listing API\n');
    console.log('===========================\n');

    // Step 1: Login as momo (verified seller)
    console.log('Step 1: Logging in as momo@gmail.com...');
    const loginResponse = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'momo@gmail.com',
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

    // Step 2: Get categories from database
    console.log('Step 2: Checking available categories...');
    const categoriesResult = await pool.query(
      'SELECT category_id, category_name, is_active FROM permitted_categories WHERE is_active = true ORDER BY category_name'
    );
    
    console.log(`Found ${categoriesResult.rows.length} active categories:`);
    categoriesResult.rows.forEach(cat => {
      console.log(`  - ${cat.category_name} (${cat.category_id})`);
    });
    console.log();

    // Step 3: Test with the exact data from the screenshot + Add logging
    const listingData = {
      title: 'Asta Wig Black Clover',
      description: 'Its a good quality wig. golden wig Asta Wig Black Clover',
      category: 'Commissions & Crafting Services', // From screenshot
      post_type: 'sell', // Try with post_type directly
      price: 500,
      condition: 'new',
      photo_ids: []
    };

    console.log('Step 3: Testing listing creation with CORRECTED data (post_type: sell)...');
    console.log('Request body:', JSON.stringify(listingData, null, 2));

    const createResponse = await fetch(`${API_BASE}/marketplace/listings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(listingData)
    });

    console.log('\nResponse Status:', createResponse.status);
    const responseText = await createResponse.text();
    
    if (!createResponse.ok) {
      console.log('❌ Create listing failed');
      console.log('Response:', responseText);
      
      try {
        const errorData = JSON.parse(responseText);
        console.log('\nError details:');
        console.log('  - error:', errorData.error);
        console.log('  - message:', errorData.message);
        if (errorData.fields) {
          console.log('  - fields:', JSON.stringify(errorData.fields, null, 2));
        }
      } catch (e) {
        // Not JSON
      }
      
      // Try different category names
      console.log('\n\nStep 4: Testing with different category variations...');
      const categoryVariations = [
        'Commissions & Crafting Services',
        'Costumes & Cosplay',
        'Wigs',
        'Props & Accessories'
      ];
      
      for (const catName of categoryVariations) {
        const testData = { ...listingData, category: catName };
        console.log(`\nTrying category: "${catName}"`);
        
        const testResponse = await fetch(`${API_BASE}/marketplace/listings`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(testData)
        });
        
        if (testResponse.ok) {
          console.log(`✅ SUCCESS with category: "${catName}"`);
          const result = await testResponse.json();
          console.log('Created listing ID:', result.listing_id);
          break;
        } else {
          const errText = await testResponse.text();
          try {
            const errData = JSON.parse(errText);
            console.log(`❌ Failed: ${errData.message || errData.error}`);
          } catch {
            console.log(`❌ Failed: ${testResponse.status}`);
          }
        }
      }
    } else {
      console.log('✅ Listing created successfully!');
      const result = JSON.parse(responseText);
      console.log('Listing ID:', result.listing_id);
      console.log('Status:', result.listing_status);
    }

  } catch (error) {
    console.error('\n❌ Test Error:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await pool.end();
  }
}

test();

/**
 * E2E Test for Curated Chat Terms
 * 
 * Creates throwaway phrase file, starts server on port 3999 with env override,
 * proves phrase blocks messages (422 + not in DB) and benign passes (200 + in DB).
 * 
 * NEVER touches real chat_curated_terms_kept.txt or real data files.
 * Server runs isolated on port 3999, dies after test.
 */

import { Pool } from 'pg';
import { config as loadEnv } from 'dotenv';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

loadEnv();

const pool = new Pool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
});

const BASE_URL = 'http://localhost:3999';
const THROWAWAY_FILE = path.resolve(__dirname, 'data', 'chat_curated_e2e_throwaway.txt');

const testIds: {
  users: string[];
  listings: string[];
  threads: string[];
  messages: string[];
} = { users: [], listings: [], threads: [], messages: [] };

let passed = 0;
let failed = 0;
let serverProcess: ChildProcess | null = null;

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

async function createTestUser(verified = true): Promise<{ user_id: string; token: string; email: string }> {
  const email = `verify-chat-e2e-${randomId()}@example.test`;
  const displayName = `Test User ${randomId()}`;
  
  const userResult = await pool.query(
    `INSERT INTO users (email, display_name, password_hash, marketplace_role, seller_display_name, 
                        payout_method_label, payout_method_number, is_cosplayer, base_body_selection,
                        verification_status)
     VALUES ($1, $2, $3, $4, $2, 'Gcash', '09171234567', true, 'female', $5)
     RETURNING user_id`,
    [email, displayName, '$2a$10$fakehashfakehashfakehashfakehashfakehashfakehash', 
     verified ? 'both' : null, verified ? 'verified' : 'not_submitted']
  );
  
  const user_id = userResult.rows[0].user_id;
  testIds.users.push(user_id);
  
  const token = randomId() + randomId() + randomId();
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  
  await pool.query(
    `INSERT INTO sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 days')`,
    [user_id, tokenHash]
  );
  
  return { user_id, token, email };
}

async function createTestListing(seller_user_id: string, status = 'active'): Promise<string> {
  const result = await pool.query(
    `INSERT INTO listings (seller_user_id, item_title, item_description, category_id,
                          transaction_type, price, condition, listing_status)
     VALUES ($1, $2, $3,
             (SELECT category_id FROM permitted_categories LIMIT 1),
             'buy', 100.00, 'good', $4)
     RETURNING listing_id`,
    [seller_user_id, `Test Item E2E ${randomId()}`, 'Test description', status]
  );
  
  const listing_id = result.rows[0].listing_id;
  testIds.listings.push(listing_id);
  return listing_id;
}

async function fetchWithAuth(path: string, token: string, options: any = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers,
  };
  
  return fetch(`${BASE_URL}${path}`, { ...options, headers });
}

function pass(test: string) {
  console.log(`✓ ${test}`);
  passed++;
}

function fail(test: string, reason: string) {
  console.log(`✗ ${test}: ${reason}`);
  failed++;
}

async function cleanup() {
  try {
    // Stop server
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!serverProcess.killed) {
        serverProcess.kill('SIGKILL');
      }
      serverProcess = null;
    }
    
    // Delete throwaway file
    if (fs.existsSync(THROWAWAY_FILE)) {
      fs.unlinkSync(THROWAWAY_FILE);
    }
    
    // Clean DB
    if (testIds.messages.length > 0) {
      await pool.query(`DELETE FROM chat_messages WHERE message_id = ANY($1::uuid[])`, [testIds.messages]);
    }
    if (testIds.threads.length > 0) {
      await pool.query(`DELETE FROM chat_threads WHERE thread_id = ANY($1::uuid[])`, [testIds.threads]);
    }
    if (testIds.listings.length > 0) {
      await pool.query(`DELETE FROM listings WHERE listing_id = ANY($1::uuid[])`, [testIds.listings]);
    }
    if (testIds.users.length > 0) {
      await pool.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [testIds.users]);
      await pool.query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [testIds.users]);
    }
    
    const leftoverCount = await pool.query(
      `SELECT 
         (SELECT COUNT(*) FROM users WHERE email LIKE 'verify-chat-e2e-%@example.test') +
         (SELECT COUNT(*) FROM listings WHERE listing_id = ANY($1::uuid[])) +
         (SELECT COUNT(*) FROM chat_threads WHERE thread_id = ANY($2::uuid[])) +
         (SELECT COUNT(*) FROM chat_messages WHERE message_id = ANY($3::uuid[])) AS total`,
      [testIds.listings, testIds.threads, testIds.messages]
    );
    
    return parseInt(leftoverCount.rows[0].total, 10);
  } catch (error) {
    console.error('Cleanup error:', error);
    return -1;
  }
}

function startServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PORT: '3999',
      CHAT_CURATED_FILE: THROWAWAY_FILE
    };
    
    serverProcess = spawn('node', ['dist/index.js'], { 
      env,
      stdio: 'pipe',
      cwd: path.resolve(__dirname, '..')
    });
    
    let output = '';
    let resolved = false;
    
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Server startup timeout'));
      }
    }, 10000);
    
    serverProcess.stdout?.on('data', (data) => {
      output += data.toString();
      if (!resolved && output.includes('Server running on port 3999')) {
        resolved = true;
        clearTimeout(timeout);
        resolve();
      }
    });
    
    serverProcess.stderr?.on('data', (data) => {
      output += data.toString();
    });
    
    serverProcess.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
    
    serverProcess.on('exit', (code) => {
      if (!resolved && code !== 0) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

async function runTests() {
  try {
    console.log('=== E2E Test: Curated Chat Terms ===\n');
    
    // STEP 1: Create throwaway file with test phrase
    const throwawayPhrase = 'e2e test harmful phrase 9z8y7x';
    fs.writeFileSync(THROWAWAY_FILE, `# E2E Test Throwaway\n${throwawayPhrase}\n`, 'utf8');
    console.log(`✓ Created throwaway file: ${THROWAWAY_FILE}`);
    console.log(`  Phrase: [hidden for security]`);
    
    // STEP 2: Start server on port 3999 with env override
    console.log('\n✓ Starting server on port 3999 with CHAT_CURATED_FILE override...');
    await startServer();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Allow server to fully initialize
    console.log('✓ Server started');
    
    // STEP 3: Create test users and listing
    const seller = await createTestUser(true);
    const buyer = await createTestUser(true);
    const listing = await createTestListing(seller.user_id, 'active');
    
    // STEP 4: Create thread
    const threadRes = await fetchWithAuth('/marketplace/chat/threads', buyer.token, {
      method: 'POST',
      body: JSON.stringify({ listing_id: listing })
    });
    
    if (threadRes.status !== 201) {
      fail('E2E Setup', `Failed to create thread: ${threadRes.status}`);
      return;
    }
    
    const threadData = await threadRes.json();
    const thread_id = threadData.thread_id;
    testIds.threads.push(thread_id);
    
    // STEP 5: Test blocked message (throwaway phrase)
    const blockedRes = await fetchWithAuth(`/marketplace/chat/threads/${thread_id}/messages`, buyer.token, {
      method: 'POST',
      body: JSON.stringify({ message_text: `This contains ${throwawayPhrase} which should block` })
    });
    
    if (blockedRes.status === 422) {
      pass('E2E: Throwaway phrase blocked with 422');
      
      // Verify NOT in DB
      const dbCheck = await pool.query(
        `SELECT COUNT(*) as count FROM chat_messages 
         WHERE thread_id = $1 AND message_text LIKE $2`,
        [thread_id, `%${throwawayPhrase}%`]
      );
      
      if (parseInt(dbCheck.rows[0].count, 10) === 0) {
        pass('E2E: Blocked message NOT in database');
      } else {
        fail('E2E: Blocked message in DB', 'Message should not be persisted');
      }
    } else {
      fail('E2E: Throwaway phrase block', `Expected 422, got ${blockedRes.status}`);
    }
    
    // STEP 6: Test benign message passes
    const benignText = 'This is a completely benign message about the listing';
    const benignRes = await fetchWithAuth(`/marketplace/chat/threads/${thread_id}/messages`, buyer.token, {
      method: 'POST',
      body: JSON.stringify({ message_text: benignText })
    });
    
    if (benignRes.status === 201) {
      pass('E2E: Benign message passed with 201');
      
      const benignData = await benignRes.json();
      testIds.messages.push(benignData.message_id);
      
      // Verify IN DB
      const dbCheck = await pool.query(
        `SELECT message_id FROM chat_messages 
         WHERE message_id = $1 AND message_text = $2`,
        [benignData.message_id, benignText]
      );
      
      if (dbCheck.rows.length === 1) {
        pass('E2E: Benign message found in database');
      } else {
        fail('E2E: Benign message in DB', 'Message should be persisted');
      }
    } else {
      fail('E2E: Benign message pass', `Expected 201, got ${benignRes.status}`);
    }
    
    // STEP 7: Verify throwaway file still intact (no corruption)
    const fileContent = fs.readFileSync(THROWAWAY_FILE, 'utf8');
    if (fileContent.includes(throwawayPhrase)) {
      pass('E2E: Throwaway file intact');
    } else {
      fail('E2E: Throwaway file', 'File corrupted or phrase missing');
    }
    
  } catch (error) {
    console.error('\nTest error:', error);
    failed++;
  } finally {
    console.log('\n=== Cleanup ===');
    const leftover = await cleanup();
    
    if (leftover === 0) {
      console.log('✓ All test data cleaned up');
    } else if (leftover > 0) {
      console.log(`✗ ${leftover} leftover records`);
      failed++;
    } else {
      console.log('✗ Cleanup verification failed');
      failed++;
    }
    
    console.log(`\n=== Results ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    
    await pool.end();
    
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();

/**
 * Create test users for verification scripts
 */

import { config } from '../src/config';

const BASE_URL = `http://localhost:${config.port}`;

const TEST_USERS = [
  {
    email: 'tester-a@forgemind.test',
    password: 'test123456',
    display_name: 'Test User A',
    is_cosplayer: true,
    is_organizer: false,
    base_body_selection: 'male',
  },
  {
    email: 'tester-b@forgemind.test',
    password: 'test123456',
    display_name: 'Test User B',
    is_cosplayer: true,
    is_organizer: false,
    base_body_selection: 'female',
  },
];

async function createUser(user: typeof TEST_USERS[0]) {
  try {
    const res = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(user),
    });

    if (res.ok) {
      console.log(`✓ Created ${user.email}`);
      return true;
    } else if (res.status === 409) {
      console.log(`~ Already exists: ${user.email}`);
      return true;
    } else {
      const error = await res.json();
      console.error(`✗ Failed to create ${user.email}:`, error);
      return false;
    }
  } catch (error) {
    console.error(`✗ Error creating ${user.email}:`, error);
    return false;
  }
}

async function main() {
  console.log('Creating test users...\n');
  
  for (const user of TEST_USERS) {
    await createUser(user);
  }
  
  console.log('\nTest users ready for verification scripts.');
}

main().catch(console.error);

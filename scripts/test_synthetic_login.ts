const API = 'http://localhost:3000';
const email = `test${Date.now()}${Math.random().toString(36).slice(2, 7)}@example.com`;
const password = 'TestPass123!';
let userId: string | null = null;

async function cleanup() {
  if (userId) {
    await fetch(`${API}/dev/delete-user/${userId}`, { method: 'DELETE' }).catch(() => {});
  }
}

async function main() {
  try {
    const regResp = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        name: 'Test User',
        phone: '+639123456789',
        display_name: 'TestUser',
        base_body_selection: 'male',
      }),
    });
    const regData = await regResp.json();
    userId = regData.user?.user_id;
    console.log(`Register: ${regResp.status}`);

    const loginResp = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    console.log(`Login: ${loginResp.status}`);
  } finally {
    await cleanup();
  }
}

main();

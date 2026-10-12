const API = 'http://localhost:3000';

async function test(name: string, body: any) {
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    const fieldNames = data.fields ? Object.keys(data.fields).join(', ') : 'none';
    console.log(`${name}: ${r.status} error=${data.error || 'none'} fields=${fieldNames}`);
  } catch (e: any) {
    console.log(`${name}: network error ${e.message}`);
  }
}

async function main() {
  await test('(i) empty', {});
  await test('(ii) email only', { email: 'test@example.com' });
  await test('(iii) password only', { password: 'password123' });
  await test('(iv) spaces+caps', { email: '  TEST@EXAMPLE.COM  ', password: 'password123' });
  await test('(v) nonexistent', { email: 'nonexistent@example.com', password: 'password123' });
}

main();

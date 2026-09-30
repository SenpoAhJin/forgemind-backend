import cors from 'cors';
import express from 'express';
import os from 'node:os';
import { authRouter } from './auth/router';
import { config } from './config';
import { pool } from './db';

const app = express();

/**
 * Ports an Expo dev server may be reached on. A browser origin is only accepted
 * on one of these, so this is not a blanket "any LAN origin" rule.
 */
const EXPO_DEV_PORTS = new Set(['8081', '19006', '8082']);

/** True for RFC1918 addresses plus loopback and `.local` mDNS names. */
function isPrivateLanHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/**
 * Native iOS/Android `fetch` sends no `Origin` header and is therefore not
 * subject to CORS at all — these rules only govern Expo web. A web preview
 * opened on the LAN (`http://192.168.1.5:8081`) has an origin that cannot be
 * written down in advance, because the PC's address changes with the network,
 * so private-LAN origins on Expo dev ports are accepted alongside the explicit
 * `CORS_ORIGINS` list.
 */
function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (config.corsOrigins.includes(origin)) return true;
  const m = /^http:\/\/([^/:]+|\[[^\]]+\])(?::(\d+))?$/.exec(origin);
  if (!m) return false;
  const port = m[2] ?? '';
  if (!EXPO_DEV_PORTS.has(port)) return false;
  return isPrivateLanHost(m[1].replace(/^\[|\]$/g, ''));
}

/**
 * Browser clients (Expo web) are subject to CORS; native clients are not.
 * The allowlist is explicit — an empty CORS_ORIGINS blocks browser access rather
 * than defaulting to "*", because the auth endpoints are credential-bearing.
 */
if (config.corsOrigins.length > 0) {
  app.use(
    cors({
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true,
    }),
  );
}

app.use(express.json());

/**
 * Phase 3 Step 2 scope: backend + database only.
 * The listing-screener AI endpoint is deliberately NOT implemented — it is gated
 * on the Path 1 / Path 2 decision in docs/ai/LISTING_SCREENER_AI_PLAN.md.
 */
app.get('/health', async (_req, res) => {
  try {
    const result = await pool.query('SELECT current_database() AS db, current_user AS role');
    res.json({
      status: 'ok',
      database: result.rows[0].db,
      role: result.rows[0].role,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: (err as Error).message });
  }
});

/**
 * Phase 3 Step 3: real authentication against PostgreSQL.
 * See src/auth/router.ts for the endpoint contract.
 */
app.use('/auth', authRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'not_found', message: 'No such endpoint' });
});

/**
 * Terminal error handler. Without this, Express answers a malformed JSON body
 * with its default HTML page, which embeds a stack trace and absolute server
 * paths in the response.
 */
app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const isBodyParseError = err.type === 'entity.parse.failed';
  if (isBodyParseError) {
    res.status(400).json({ error: 'invalid_json', message: 'Request body is not valid JSON' });
    return;
  }
  console.error('[api] unhandled error:', err.message);
  res.status(err.status ?? 500).json({
    error: 'server_error',
    message: 'Something went wrong. Please try again.',
  });
});

/** Non-internal IPv4 addresses, so the startup banner shows a usable URL. */
function lanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found;
}

const server = app.listen(config.port, config.host, () => {
  console.log(`forgemind-backend listening on ${config.host}:${config.port} (${config.nodeEnv})`);
  if (config.corsOrigins.length > 0) {
    console.log(`CORS origins: ${config.corsOrigins.join(', ')} (plus private-LAN origins on Expo dev ports)`);
  } else {
    console.log('CORS origins: none configured (browser requests will be blocked)');
  }

  // The device reads this host out of Metro, so print exactly what the phone
  // will use rather than making the reader run `ipconfig` themselves.
  for (const address of lanAddresses()) {
    console.log(`  phone / LAN:  http://${address}:${config.port}`);
  }
  console.log('  this PC:      http://localhost:' + config.port);
  console.log('  android emu:  http://10.0.2.2:' + config.port);
  console.log('  health:       GET /health');
});

const shutdown = async (): Promise<void> => {
  server.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;

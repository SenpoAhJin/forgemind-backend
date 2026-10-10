import cors from 'cors';
import express from 'express';
import os from 'node:os';
import * as path from 'path';
import { authRouter } from './auth/router';
import { calendarRouter } from './calendar/router';
import { usersRouter } from './users/router';
import { marketplaceRouter } from './marketplace/router';
import photosRouter from './marketplace/photosRouter';
import { startPhotoCleanup, stopPhotoCleanup } from './marketplace/photoCleanup';
import { config } from './config';
import { pool } from './db';
import { classifyDbError } from './db/errors';

const app = express();

/**
 * Ports an Expo dev server may be reached on. A browser origin is only accepted
 * on one of these, so this is not a blanket "any LAN origin" rule.
 */
const EXPO_DEV_PORTS = new Set(['8081', '19006', '8082']);

/** True for RFC1918 addresses plus loopback and `.local` mDNS names. */
function isPrivateLanHost(host: string): boolean {
  // 127.0.0.1 is included because Expo web on this machine frequently resolves
  // its own origin as http://127.0.0.1:8081 rather than http://localhost:8081,
  // and refusing that origin would silently break the very first request.
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) return true;
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
  // Config guard: refuse to connect if password is masked or empty
  if (config.dbPasswordInvalid) {
    return res.status(503).json({
      status: 'error',
      db: 'unavailable',
    });
  }

  try {
    await pool.query('SELECT 1');
    res.json({
      status: 'ok',
      db: 'ok',
    });
  } catch (err) {
    const classification = classifyDbError(err);
    console.error(`[health] database check failed: ${classification.logReason}`);
    res.status(503).json({
      status: 'error',
      db: 'unavailable',
    });
  }
});

/**
 * Phase 3 Step 3: real authentication against PostgreSQL.
 * See src/auth/router.ts for the endpoint contract.
 */
app.use('/auth', authRouter);

/**
 * Public Event Calendar: community-submitted event listings
 * See src/calendar/router.ts for endpoint details
 */
app.use('/calendar', calendarRouter);

/**
 * User Management: list users, verification (Head only)
 * See src/users/router.ts for endpoint details
 */
app.use('/users', usersRouter);

/**
 * Marketplace photos: upload and attach to listings.
 * Must come before marketplaceRouter (JSON-only middleware incompatible with multipart).
 */
app.use('/marketplace', photosRouter);

/**
 * Marketplace Registration: cosplayer submits, reads back own registration.
 * See src/marketplace/router.ts for endpoint details
 */
app.use('/marketplace', marketplaceRouter);

/**
 * Serve uploaded photos with safe headers.
 */
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
  setHeaders: (res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'public, max-age=31536000');
  },
}));

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

/**
 * Check database connectivity at startup.
 * Logs clear status but does NOT exit on failure — keep the server running
 * so /health is diagnosable.
 */
async function checkDatabaseConnection(): Promise<void> {
  if (config.dbPasswordInvalid) {
    console.error('database: UNAVAILABLE (DB_PASSWORD is empty or a placeholder mask)');
    return;
  }

  try {
    await pool.query('SELECT 1');
    console.log('database: OK');
  } catch (err) {
    const classification = classifyDbError(err);
    console.error(`database: UNREACHABLE (${classification.logReason})`);
  }
}

const server = app.listen(config.port, config.host, async () => {
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

  // Check database after server starts
  await checkDatabaseConnection();
  
  // Start photo cleanup timer
  startPhotoCleanup();
});

const shutdown = async (): Promise<void> => {
  stopPhotoCleanup();
  server.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;

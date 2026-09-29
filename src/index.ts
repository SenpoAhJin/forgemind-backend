import cors from 'cors';
import express from 'express';
import { authRouter } from './auth/router';
import { config } from './config';
import { pool } from './db';

const app = express();

/**
 * Browser clients (Expo web) are subject to CORS; native clients are not.
 * The allowlist is explicit — an empty CORS_ORIGINS blocks browser access rather
 * than defaulting to "*", because the auth endpoints are credential-bearing.
 */
if (config.corsOrigins.length > 0) {
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
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

const server = app.listen(config.port, () => {
  console.log(`forgemind-backend listening on :${config.port} (${config.nodeEnv})`);
  if (config.corsOrigins.length > 0) {
    console.log(`CORS origins: ${config.corsOrigins.join(', ')}`);
  } else {
    console.log('CORS origins: none configured (browser requests will be blocked)');
  }
});

const shutdown = async (): Promise<void> => {
  server.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;

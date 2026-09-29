import express from 'express';
import { config } from './config';
import { pool } from './db';

const app = express();

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

const server = app.listen(config.port, () => {
  console.log(`forgemind-backend listening on :${config.port} (${config.nodeEnv})`);
});

const shutdown = async (): Promise<void> => {
  server.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export default app;

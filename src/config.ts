import { config as loadEnv } from 'dotenv';

loadEnv();

/**
 * All configuration is read from environment variables. No connection string is
 * hardcoded anywhere in this codebase.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

/**
 * Guard against placeholder/masked passwords in .env.
 * Returns the value if valid, or null if it's a placeholder.
 */
function requiredPassword(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`${name} is empty or missing. Set the real password in forgemind-backend/.env.`);
    return null;
  }
  if (value === '****') {
    console.error(`${name} is a placeholder mask (****). Set the real password in forgemind-backend/.env.`);
    return null;
  }
  return value;
}

/** Comma-separated origin allowlist, e.g. "http://localhost:8081,http://localhost:19006". */
function parseOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);

const dbPassword = requiredPassword('DB_PASSWORD');

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  /**
   * Interface to bind. 0.0.0.0 is required for a physical phone on the same
   * LAN to reach this API: binding to 127.0.0.1 makes the server reachable only
   * from the PC, so every request from a device fails with a connection error.
   */
  host: process.env.HOST ?? '0.0.0.0',
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: dbPassword ?? '****', // Keep masked if invalid so pool creation doesn't throw
    ssl: process.env.DB_SSL === 'true',
  },
  /**
   * True if DB_PASSWORD is missing, empty, or a placeholder mask.
   * When true, all database operations must fail with 503 db_unavailable.
   */
  dbPasswordInvalid: dbPassword === null,
  session: {
    ttlDays: SESSION_TTL_DAYS,
    ttlMs: SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  },
  /**
   * Browser origins allowed to call this API. Empty means "no browser origins",
   * which is the correct default for native-only clients.
   */
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
};

/**
 * Assembled at runtime for tooling that wants a single URL. Never logged.
 */
export function connectionString(): string {
  const { host, port, database, user, password } = config.db;
  const encoded = encodeURIComponent(password);
  return `postgresql://${user}:${encoded}@${host}:${port}/${database}`;
}

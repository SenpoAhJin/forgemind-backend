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

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    ssl: process.env.DB_SSL === 'true',
  },
};

/**
 * Assembled at runtime for tooling that wants a single URL. Never logged.
 */
export function connectionString(): string {
  const { host, port, database, user, password } = config.db;
  const encoded = encodeURIComponent(password);
  return `postgresql://${user}:${encoded}@${host}:${port}/${database}`;
}

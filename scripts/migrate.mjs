#!/usr/bin/env node
/**
 * node-pg-migrate wrapper.
 *
 * WHY THIS EXISTS
 * The .env file carries BOTH individual credentials (DB_HOST, DB_PORT, DB_NAME,
 * DB_USER, DB_PASSWORD) and a pre-assembled DB_URL. Keeping two copies of the
 * same secret in sync by hand is a real failure mode: editing DB_PASSWORD while
 * leaving DB_URL stale produces "password authentication failed" even though the
 * password is correct.
 *
 * This wrapper makes the DB_* variables the single source of truth and derives
 * the connection string at run time, so the two can never disagree.
 *
 * The password is placed into the child's environment only. It is never logged,
 * never echoed, and never written to a file.
 *
 * Usage: node scripts/migrate.mjs <up|down|redo> [extra node-pg-migrate args]
 */

import { spawn } from 'node:child_process';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

loadEnv();

const { host, port, database, user, password, ssl } = configDb();

function configDb() {
  const required = (name) => {
    const v = process.env[name];
    if (!v || v.trim() === '') {
      throw new Error(
        `Missing required environment variable ${name}. Populate .env and retry.`,
      );
    }
    return v;
  };
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    ssl: process.env.DB_SSL === 'true',
  };
}

const authority = ssl ? `${host}:${port}?sslmode=require` : `${host}:${port}`;
const databaseUrl = `postgresql://${user}:${encodeURIComponent(password)}@${authority}/${database}`;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const cli = path.join(root, 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/migrate.mjs <up|down|redo> [options]');
  process.exit(1);
}

console.log(
  `migrating -> ${user}@${host}:${port}/${database} (password not printed)`,
);

const child = spawn(process.execPath, [cli, ...args], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: databaseUrl },
});

child.on('error', (err) => {
  console.error(`Failed to launch node-pg-migrate: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`node-pg-migrate terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

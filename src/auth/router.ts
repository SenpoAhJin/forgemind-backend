/**
 * Authentication routes: POST /auth/register, POST /auth/login, POST /auth/logout.
 *
 * Phase 3 Step 3. Scope is deliberately narrow — nothing else in the app is
 * moved off AsyncStorage by this router.
 *
 * Session design: the client receives an opaque 256-bit token exactly once and
 * sends it back as `Authorization: Bearer <token>`. Only its SHA-256 hash is
 * stored (`sessions.refresh_token_hash`), so the table holds no usable tokens.
 */

import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { config } from '../config';
import { query } from '../db';
import { generateSessionToken, hashPassword, hashSessionToken, verifyPassword } from './crypto';
import { PublicUser, USER_PUBLIC_COLUMNS } from './publicUser';
import { validateLoginInput, validateRegisterInput } from './validation';

export const authRouter = Router();

/** Express 4 does not forward rejected promises to the error handler. */
const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** PostgreSQL unique_violation. */
const UNIQUE_VIOLATION = '23505';

interface SessionGrant {
  token: string;
  expiresAt: Date;
}

/**
 * A real bcrypt hash of a value nobody knows, used to burn the same amount of
 * CPU on a miss as on a hit. Computed once, lazily, so startup is not slowed.
 */
let decoyHashPromise: Promise<string> | null = null;
function getDecoyHash(): Promise<string> {
  if (!decoyHashPromise) {
    decoyHashPromise = hashPassword('forgemind-timing-decoy');
  }
  return decoyHashPromise;
}

/**
 * Normalises the socket address for the `sessions.ip_address INET` column.
 * Node reports IPv4 loopback in the IPv4-mapped form `::ffff:127.0.0.1`, which
 * is valid INET input, but the bare IPv4 form reads better in a psql dump.
 */
function normaliseIp(rawIp: string | undefined): string | null {
  if (!rawIp) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(rawIp);
  return mapped ? mapped[1] : rawIp;
}

/** Accepts a plain object, or null. Anything else is discarded, never stored. */
function sanitiseDeviceInfo(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/**
 * Creates a session row and returns the one-time plaintext token. The caller
 * owns the transaction; these routes do not wrap their own writes in BEGIN.
 */
async function issueSession(userId: string, req: Request): Promise<SessionGrant> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + config.session.ttlMs);

  const body = req.body as Record<string, unknown> | undefined;
  const deviceInfo = sanitiseDeviceInfo(body?.device_info);
  const ipAddress = normaliseIp(req.ip);

  await query(
    `INSERT INTO sessions (user_id, refresh_token_hash, device_info, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, deviceInfo ? JSON.stringify(deviceInfo) : null, ipAddress, expiresAt],
  );

  return { token, expiresAt };
}

/** Pulls the bearer token out of the Authorization header. */
function readBearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}

/**
 * POST /auth/register
 *
 * Does NOT create a session: the mobile app deliberately does not auto-login on
 * registration (RegisterScreen shows a success modal, then sends the user to
 * the login screen), so issuing a token here would strand an unused session row.
 */
authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = validateRegisterInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: 'validation_error', message: parsed.message, fields: parsed.fields });
      return;
    }
    const input = parsed.value;

    const existing = await query<{ user_id: string }>(
      'SELECT user_id FROM users WHERE email = $1',
      [input.email],
    );
    if (existing.length > 0) {
      res.status(409).json({
        error: 'email_taken',
        message: 'An account with this email already exists',
        fields: { email: 'An account with this email already exists' },
      });
      return;
    }

    const passwordHash = await hashPassword(input.password);

    let created: PublicUser[];
    try {
      created = await query<PublicUser>(
        `INSERT INTO users (email, password_hash, display_name, is_cosplayer, is_organizer, base_body_selection)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${USER_PUBLIC_COLUMNS}`,
        [
          input.email,
          passwordHash,
          input.display_name,
          input.is_cosplayer,
          input.is_organizer,
          input.base_body_selection,
        ],
      );
    } catch (err) {
      // Lost the race against a concurrent signup for the same address.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        res.status(409).json({
          error: 'email_taken',
          message: 'An account with this email already exists',
          fields: { email: 'An account with this email already exists' },
        });
        return;
      }
      throw err;
    }

    res.status(201).json({ user: created[0] });
  }),
);

/**
 * POST /auth/login
 * Verifies the password against the stored bcrypt hash, then issues a session.
 */
authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = validateLoginInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: 'validation_error', message: parsed.message, fields: parsed.fields });
      return;
    }
    const input = parsed.value;

    const rows = await query<PublicUser & { password_hash: string }>(
      `SELECT ${USER_PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`,
      [input.email],
    );

    // An unknown email and a wrong password are answered identically, so the
    // response cannot be used to discover which addresses have accounts.
    const invalid = {
      error: 'invalid_credentials',
      message: 'Invalid email or password',
    };

    if (rows.length === 0) {
      await verifyPassword(input.password, await getDecoyHash());
      res.status(401).json(invalid);
      return;
    }

    const { password_hash: storedHash, ...publicUser } = rows[0];
    const ok = await verifyPassword(input.password, storedHash);
    if (!ok) {
      res.status(401).json(invalid);
      return;
    }

    const grant = await issueSession(publicUser.user_id, req);

    res.status(200).json({
      user: publicUser,
      session_token: grant.token,
      expires_at: grant.expiresAt.toISOString(),
    });
  }),
);

/**
 * POST /auth/logout
 * Deletes the session row. An unknown or already-revoked token is a 401,
 * because there is no session left to revoke.
 */
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = readBearerToken(req);
    if (!token) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing or malformed Authorization header',
      });
      return;
    }

    const deleted = await query<{ session_id: string }>(
      'DELETE FROM sessions WHERE refresh_token_hash = $1 RETURNING session_id',
      [hashSessionToken(token)],
    );

    if (deleted.length === 0) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Session is unknown, already revoked, or expired',
      });
      return;
    }

    res.status(200).json({ success: true });
  }),
);

authRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Log the message only. Never the request body — it carries a plaintext password.
  console.error('[auth] unhandled error:', err.message);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
});

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
import {
  EMPTY_ORGANIZER_FIELDS,
  OrganizerFields,
  readOrganizerFields,
  validateLoginInput,
  validateOrganizerFields,
  validateRegisterInput,
} from './validation';

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

    // organizer_role / head_organizer_department / department /
    // department_verification_status are written here, on the INSERT, so a Head
    // or Staff account exists with its role already in PostgreSQL. They were
    // previously only ever recorded in the phone's local storage, which meant the
    // role did not survive the login that immediately followed registration.
    const organizer = input.organizer ?? EMPTY_ORGANIZER_FIELDS;

    let created: PublicUser[];
    try {
      created = await query<PublicUser>(
        `INSERT INTO users (
           email, password_hash, display_name, is_cosplayer, is_organizer, base_body_selection,
           organizer_role, head_organizer_department, department, department_verification_status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${USER_PUBLIC_COLUMNS}`,
        [
          input.email,
          passwordHash,
          input.display_name,
          input.is_cosplayer,
          input.is_organizer,
          input.base_body_selection,
          organizer.organizer_role,
          organizer.head_organizer_department,
          organizer.department,
          organizer.department_verification_status,
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

/** Resolves a bearer token to the user it was issued to, or null. */
async function resolveSession(
  req: Request,
): Promise<{ user_id: string; email: string; organizer_role: string | null } | null> {
  const token = readBearerToken(req);
  if (!token) return null;
  const rows = await query<{
    user_id: string;
    email: string;
    organizer_role: string | null;
  }>(
    `SELECT u.user_id, u.email, u.organizer_role
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
      WHERE s.refresh_token_hash = $1 AND s.expires_at > NOW()`,
    [hashSessionToken(token)],
  );
  return rows.length > 0 ? rows[0] : null;
}

/**
 * PATCH /auth/organizer-fields
 *
 * Writes organizer_role, head_organizer_department, department and
 * department_verification_status to PostgreSQL, so that a Head approving a Staff
 * member (or a Staff member being created) is recorded by the server instead of
 * only in one phone's local storage. Before this existed, every approval lived in
 * AsyncStorage and was discarded by the next login, which re-read the user row.
 *
 * Authorization: only an account that is already a Head Organizer on the server
 * may change organizer fields, and only on another account or its own. A caller
 * can never grant itself a role, because the role is read from the caller's own
 * row rather than from anything it sent.
 */
authRouter.patch(
  '/organizer-fields',
  asyncHandler(async (req, res) => {
    const caller = await resolveSession(req);
    if (!caller) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
      return;
    }

    if (caller.organizer_role !== 'head') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only a Head Organizer can change organizer roles or department access',
      });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    const targetEmail =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!targetEmail) {
      res.status(400).json({ error: 'validation_error', message: 'email is required' });
      return;
    }

    const patch = readOrganizerFields(body);
    if (!patch) {
      res.status(400).json({
        error: 'validation_error',
        message: 'No organizer fields supplied',
      });
      return;
    }
    if (!patch.ok) {
      res.status(400).json({ error: 'validation_error', message: patch.message });
      return;
    }

    const targets = await query<OrganizerFields>(
      `SELECT organizer_role, head_organizer_department, department,
              department_verification_status, department_rejection_reason
         FROM users WHERE email = $1`,
      [targetEmail],
    );
    if (targets.length === 0) {
      res.status(404).json({ error: 'not_found', message: 'No such account' });
      return;
    }

    // Validate against the row as it WOULD be, so a partial update cannot
    // leave it violating chk_head_has_department / chk_staff_has_department.
    //
    // The merge tests key PRESENCE rather than nullishness: `readOrganizerFields`
    // omits keys the caller did not send, but includes a key explicitly sent as
    // null so the column can be cleared. Using `??` here would silently discard
    // every explicit null and make clearing a field impossible.
    const current = targets[0];
    const wanted = patch.value;
    const merged: OrganizerFields = {
      organizer_role:
        'organizer_role' in wanted ? wanted.organizer_role ?? null : current.organizer_role ?? null,
      head_organizer_department:
        'head_organizer_department' in wanted
          ? wanted.head_organizer_department ?? null
          : current.head_organizer_department ?? null,
      department: 'department' in wanted ? wanted.department ?? null : current.department ?? null,
      department_verification_status:
        'department_verification_status' in wanted
          ? wanted.department_verification_status ?? null
          : current.department_verification_status ?? null,
      department_rejection_reason: current.department_rejection_reason ?? null,
    };

    // The rejection reason is free text rather than a CHECK-constrained enum, so
    // it is read separately. An empty string clears it.
    if (typeof body?.department_rejection_reason === 'string') {
      merged.department_rejection_reason = body.department_rejection_reason.trim() || null;
    }

    const checked = validateOrganizerFields(merged);
    if (!checked.ok) {
      res.status(400).json({
        error: 'validation_error',
        message: checked.message,
        fields: checked.fields,
      });
      return;
    }

    const updated = await query<PublicUser>(
      `UPDATE users
          SET organizer_role = $1,
              head_organizer_department = $2,
              department = $3,
              department_verification_status = $4,
              department_rejection_reason = $5,
              updated_at = NOW()
        WHERE email = $6
        RETURNING ${USER_PUBLIC_COLUMNS}`,
      [
        checked.value.organizer_role,
        checked.value.head_organizer_department,
        checked.value.department,
        checked.value.department_verification_status,
        checked.value.department_rejection_reason,
        targetEmail,
      ],
    );

    res.status(200).json({ user: updated[0] });
  }),
);

authRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Log the message only. Never the request body — it carries a plaintext password.
  console.error('[auth] unhandled error:', err.message);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
});

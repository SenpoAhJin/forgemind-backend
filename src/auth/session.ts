/**
 * Session resolution shared by the authenticated routers.
 *
 * A bearer token is hashed and matched against `sessions.refresh_token_hash`;
 * the user is then read from `users`, so every downstream permission check is
 * made against server-side state rather than anything the client sent.
 */

import { Request } from 'express';
import { createHash } from 'node:crypto';
import { query } from '../db';

export interface SessionUser {
  user_id: string;
  email: string;
  display_name: string;
  organizer_role: 'head' | 'staff' | null;
  head_organizer_department: string | null;
  department: string | null;
  is_organizer: boolean;
  is_cosplayer: boolean;
  verification_status: string;
  banned: boolean;
}

export function readBearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function resolveSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readBearerToken(req);
  if (!token) return null;

  const rows = await query<{
    user_id: string;
    email: string;
    display_name: string;
    organizer_role: string | null;
    head_organizer_department: string | null;
    department: string | null;
    is_organizer: boolean;
    is_cosplayer: boolean;
    verification_status: string;
    banned_at: Date | null;
  }>(
    `SELECT u.user_id, u.email, u.display_name, u.organizer_role,
            u.head_organizer_department, u.department, u.is_organizer,
            u.is_cosplayer, u.verification_status, m.banned_at
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
       LEFT JOIN marketplace_user_status m ON m.user_id = u.user_id
      WHERE s.refresh_token_hash = $1 AND s.expires_at > NOW()`,
    [hashSessionToken(token)],
  );

  if (rows.length === 0) return null;
  const user = rows[0];
  
  return {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    organizer_role:
      user.organizer_role === 'head' || user.organizer_role === 'staff' ? user.organizer_role : null,
    head_organizer_department: user.head_organizer_department,
    department: user.department,
    is_organizer: user.is_organizer,
    is_cosplayer: user.is_cosplayer,
    verification_status: user.verification_status,
    banned: !!user.banned_at,
  };
}

/** 401 unless a live session exists. Writes the response and returns null on failure. */
export async function requireSession(
  req: Request,
  res: import('express').Response,
): Promise<SessionUser | null> {
  const user = await resolveSessionUser(req);
  if (!user) {
    res.status(401).json({
      error: 'invalid_session',
      message: 'Missing, unknown, or expired session',
    });
    return null;
  }
  
  if (user.banned) {
    res.status(403).json({
      error: 'account_banned',
    });
    return null;
  }
  
  return user;
}

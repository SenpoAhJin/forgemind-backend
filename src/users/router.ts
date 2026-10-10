/**
 * User Management Routes
 * GET /users - list users (Head only, with filters)
 * PATCH /users/:id/verification - approve/reject cosplayer marketplace verification (Head only)
 * PATCH /users/:id/department-verification - approve/reject staff department verification (Head only, own department)
 */

import { Request, Response, Router, NextFunction } from 'express';
import { query } from '../db';
import { toRegistrationPublic, RegistrationRow } from '../marketplace/registration';
import { USER_PUBLIC_COLUMNS, PublicUser } from '../auth/publicUser';

export const usersRouter = Router();

const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Extract bearer token from Authorization header */
function readBearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}

/** Hash token to match sessions table */
function hashSessionToken(token: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Resolve session to authenticated user with role */
async function resolveSession(req: Request): Promise<{
  user_id: string;
  email: string;
  display_name: string;
  organizer_role: 'head' | 'staff' | null;
  head_organizer_department: string | null;
  department: string | null;
  is_organizer: boolean;
} | null> {
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
  }>(
    `SELECT u.user_id, u.email, u.display_name, u.organizer_role, u.head_organizer_department, u.department, u.is_organizer
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
      WHERE s.refresh_token_hash = $1 AND s.expires_at > NOW()`,
    [hashSessionToken(token)]
  );

  if (rows.length === 0) return null;
  const user = rows[0];
  return {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    organizer_role: (user.organizer_role === 'head' || user.organizer_role === 'staff') ? user.organizer_role : null,
    head_organizer_department: user.head_organizer_department,
    department: user.department,
    is_organizer: user.is_organizer,
  };
}

/**
 * GET /users
 * List users with filters (Head Organizers only)
 * Query params:
 * - role: 'cosplayer' | 'staff' | 'head'
 * - verification_status: 'pending' | 'verified' | 'rejected' | 'revoked' | 'not_submitted'
 * - department_verification_status: 'pending' | 'approved' | 'rejected'
 * - department: filter staff by department
 * - search: search by display_name or email (case-insensitive)
 * - limit: pagination limit (default 50, max 200)
 * - offset: pagination offset (default 0)
 */
usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
      return;
    }

    if (user!.organizer_role !== 'head') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only Head Organizers can list users',
      });
      return;
    }

    const {
      role,
      verification_status,
      department_verification_status,
      department,
      search,
      limit: limitParam,
      offset: offsetParam,
    } = req.query;

    const limit = Math.min(parseInt(limitParam as string) || 50, 200);
    const offset = parseInt(offsetParam as string) || 0;

    let whereClauses: string[] = [];
    let params: unknown[] = [];
    let paramIndex = 1;

    // Filter by role
    if (role === 'cosplayer') {
      whereClauses.push(`is_cosplayer = true AND (organizer_role IS NULL OR organizer_role = '')`);
    } else if (role === 'staff') {
      whereClauses.push(`organizer_role = 'staff'`);
    } else if (role === 'head') {
      whereClauses.push(`organizer_role = 'head'`);
    }

    // Filter by marketplace verification_status (cosplayers)
    if (verification_status) {
      whereClauses.push(`verification_status = $${paramIndex}`);
      params.push(verification_status);
      paramIndex++;
    }

    // Filter by department_verification_status (staff)
    if (department_verification_status) {
      whereClauses.push(`department_verification_status = $${paramIndex}`);
      params.push(department_verification_status);
      paramIndex++;
    }

    // Filter by department (staff)
    if (department) {
      whereClauses.push(`department = $${paramIndex}`);
      params.push(department);
      paramIndex++;
    }

    // Search by name or email
    if (search && typeof search === 'string' && search.trim()) {
      whereClauses.push(`(LOWER(display_name) LIKE $${paramIndex} OR LOWER(email) LIKE $${paramIndex})`);
      params.push(`%${search.trim().toLowerCase()}%`);
      paramIndex++;
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Add limit and offset
    params.push(limit, offset);

    const users = await query<
      RegistrationRow & {
        user_id: string;
        email: string;
        display_name: string;
        is_cosplayer: boolean;
        is_organizer: boolean;
        verification_status: string;
        verified_by_user_id: string | null;
        verified_at: string | null;
        rejection_reason: string | null;
        organizer_role: string | null;
        head_organizer_department: string | null;
        department: string | null;
        department_verification_status: string | null;
        department_rejection_reason: string | null;
        created_at: string;
        updated_at: string;
      }
    >(
      `SELECT 
         user_id,
         email,
         display_name,
         is_cosplayer,
         is_organizer,
         verification_status,
         verified_by_user_id,
         verified_at,
         rejection_reason,
         organizer_role,
         head_organizer_department,
         department,
         department_verification_status,
         department_rejection_reason,
         marketplace_role,
         seller_display_name,
         marketplace_contact_email,
         marketplace_contact_phone,
         payout_method_label,
         payout_method_number,
         agreed_to_marketplace_terms,
         marketplace_terms_accepted_at,
         marketplace_submitted_at,
         marketplace_rejection_reason,
         created_at,
         updated_at
       FROM users
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      params
    );

    // The Head reviews the submission; the payout number itself is masked here,
    // so this response cannot leak a full account number to any organizer.
    const payload = users.map((row) => ({
      ...row,
      registration: row.marketplace_role ? toRegistrationPublic(row) : null,
    }));

    res.json({ users: payload });
  })
);

/**
 * PATCH /users/:id/verification
 * Approve or reject cosplayer marketplace verification (Head only)
 * Body: { decision: 'approve' | 'reject', rejection_reason?: string }
 */
usersRouter.patch(
  '/:id/verification',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
      return;
    }

    if (user!.organizer_role !== 'head') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only Head Organizers can verify users',
      });
      return;
    }

    const { id } = req.params;
    const { decision, rejection_reason } = req.body;

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({
        error: 'validation_error',
        message: 'decision must be "approve" or "reject"',
      });
      return;
    }

    if (decision === 'reject' && (!rejection_reason || typeof rejection_reason !== 'string' || rejection_reason.trim().length === 0)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'rejection_reason is required when rejecting',
      });
      return;
    }

    // Fetch target user
    const targetUsers = await query(
      `SELECT user_id, display_name, verification_status FROM users WHERE user_id = $1`,
      [id]
    );

    if (targetUsers.length === 0) {
      res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
      return;
    }

    const targetUser = targetUsers[0];

    // Update verification status
    const newStatus = decision === 'approve' ? 'verified' : 'rejected';

    // RETURNING the named public columns rather than `*`: `*` would put
    // password_hash and the full payout_method_number into this response.
    const updated = await query<PublicUser>(
      `UPDATE users
          SET verification_status = $1,
              verified_by_user_id = $2,
              verified_at = NOW(),
              rejection_reason = $3,
              marketplace_rejection_reason = $3,
              updated_at = NOW()
        WHERE user_id = $4
        RETURNING ${USER_PUBLIC_COLUMNS}`,
      [
        newStatus,
        user!.user_id,
        decision === 'reject' ? rejection_reason.trim() : null,
        id,
      ]
    );

    res.json({ user: updated[0] });
  })
);

/**
 * PATCH /users/:id/department-verification
 * Approve or reject staff department verification (Head only, own department)
 * Body: { decision: 'approve' | 'reject', rejection_reason?: string }
 */
usersRouter.patch(
  '/:id/department-verification',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
      return;
    }

    if (user!.organizer_role !== 'head') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only Head Organizers can verify staff',
      });
      return;
    }

    const { id } = req.params;
    const { decision, rejection_reason } = req.body;

    if (decision !== 'approve' && decision !== 'reject') {
      res.status(400).json({
        error: 'validation_error',
        message: 'decision must be "approve" or "reject"',
      });
      return;
    }

    if (decision === 'reject' && (!rejection_reason || typeof rejection_reason !== 'string' || rejection_reason.trim().length === 0)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'rejection_reason is required when rejecting',
      });
      return;
    }

    // Fetch target user
    const targetUsers = await query(
      `SELECT user_id, display_name, organizer_role, department, department_verification_status FROM users WHERE user_id = $1`,
      [id]
    );

    if (targetUsers.length === 0) {
      res.status(404).json({
        error: 'not_found',
        message: 'User not found',
      });
      return;
    }

    const targetUser = targetUsers[0];

    // Verify staff role
    if (targetUser.organizer_role !== 'staff') {
      res.status(400).json({
        error: 'validation_error',
        message: 'Target user is not staff',
      });
      return;
    }

    // Department scope: Head can only verify staff from their own department
    if (targetUser.department !== user!.head_organizer_department) {
      res.status(403).json({
        error: 'forbidden',
        message: 'You can only verify staff from your own department',
      });
      return;
    }

    // Update department verification status
    const newStatus = decision === 'approve' ? 'approved' : 'rejected';

    const updated = await query(
      `UPDATE users
          SET department_verification_status = $1,
              department_rejection_reason = $2,
              updated_at = NOW()
        WHERE user_id = $3
        RETURNING *`,
      [
        newStatus,
        decision === 'reject' ? rejection_reason.trim() : null,
        id,
      ]
    );

    res.json({ user: updated[0] });
  })
);

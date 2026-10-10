/**
 * Public Event Calendar Routes
 * GET /calendar - list all (filtered by role)
 * GET /calendar/:id - get one
 * POST /calendar - create
 * PUT /calendar/:id - update
 * PATCH /calendar/:id/review - approve/reject (Head only)
 * DELETE /calendar/:id - delete
 */

import { Request, Response, Router, NextFunction } from 'express';
import { query } from '../db';
import { classifyDbError, generateRequestId } from '../db/errors';

export const calendarRouter = Router();

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
    department: string | null;
    head_organizer_department: string | null;
    is_organizer: boolean;
  }>(
    `SELECT u.user_id, u.email, u.display_name, u.organizer_role, u.department, u.head_organizer_department, u.is_organizer
       FROM sessions s
       JOIN users u ON u.user_id = s.user_id
      WHERE s.refresh_token_hash = $1 AND s.expires_at > NOW()`,
    [hashSessionToken(token)]
  );

  if (rows.length === 0) return null;
  const user = rows[0];
  
  // For department: use head_organizer_department if role is 'head', otherwise department
  const effectiveDepartment = user.organizer_role === 'head' 
    ? user.head_organizer_department 
    : user.department;
  
  return {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    organizer_role: (user.organizer_role === 'head' || user.organizer_role === 'staff') ? user.organizer_role : null,
    department: effectiveDepartment,
    is_organizer: user.is_organizer,
  };
}

/** Simple URL plausibility check */
function isPlausibleUrl(str: string): boolean {
  return /^https?:\/\/.+\..+/.test(str) || /^www\..+\..+/.test(str);
}

/**
 * GET /calendar
 * List public event listings
 * - Head: sees all
 * - Staff: sees approved + own (any status)
 * - Cosplayer: sees approved only
 * Optional ?status= filter
 */
calendarRouter.get(
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

    const statusFilter = req.query.status as string | undefined;
    if (statusFilter && !['pending', 'approved', 'rejected'].includes(statusFilter)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'status must be pending, approved, or rejected',
      });
      return;
    }

    let listings: any[];

    if (user!.organizer_role === 'head') {
      // Head sees all
      listings = await query(
        `SELECT l.*, u.display_name as submitted_by_name, r.display_name as reviewed_by_name
           FROM public_event_listings l
           JOIN users u ON u.user_id = l.submitted_by_user_id
           LEFT JOIN users r ON r.user_id = l.reviewed_by_user_id
          WHERE $1::varchar IS NULL OR l.status = $1
          ORDER BY l.start_date DESC, l.created_at DESC`,
        [statusFilter || null]
      );
    } else if (user!.organizer_role === 'staff') {
      // Staff sees approved + own
      listings = await query(
        `SELECT l.*, u.display_name as submitted_by_name, r.display_name as reviewed_by_name
           FROM public_event_listings l
           JOIN users u ON u.user_id = l.submitted_by_user_id
           LEFT JOIN users r ON r.user_id = l.reviewed_by_user_id
          WHERE ($1::varchar IS NULL OR l.status = $1)
            AND (l.status = 'approved' OR l.submitted_by_user_id = $2)
          ORDER BY l.start_date DESC, l.created_at DESC`,
        [statusFilter || null, user!.user_id]
      );
    } else {
      // Cosplayer sees approved only
      listings = await query(
        `SELECT l.*, u.display_name as submitted_by_name, r.display_name as reviewed_by_name
           FROM public_event_listings l
           JOIN users u ON u.user_id = l.submitted_by_user_id
           LEFT JOIN users r ON r.user_id = l.reviewed_by_user_id
          WHERE l.status = 'approved'
            AND ($1::varchar IS NULL OR l.status = $1)
          ORDER BY l.start_date DESC, l.created_at DESC`,
        [statusFilter || null]
      );
    }

    res.json({ listings });
  })
);

/**
 * GET /calendar/:id
 * Get one listing (same visibility rules as list)
 */
calendarRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
    }

    const { id } = req.params;

    const listings = await query(
      `SELECT l.*, u.display_name as submitted_by_name, r.display_name as reviewed_by_name
         FROM public_event_listings l
         JOIN users u ON u.user_id = l.submitted_by_user_id
         LEFT JOIN users r ON r.user_id = l.reviewed_by_user_id
        WHERE l.id = $1`,
      [id]
    );

    if (listings.length === 0) {
      res.status(404).json({
        error: 'not_found',
        message: 'Listing not found',
      });
    }

    const listing = listings[0];

    // Visibility check
    if (user!.organizer_role === 'head') {
      // Head sees all
    } else if (user!.organizer_role === 'staff') {
      // Staff sees approved + own
      if (listing.status !== 'approved' && listing.submitted_by_user_id !== user!.user_id) {
        res.status(403).json({
          error: 'forbidden',
          message: 'You can only view approved listings or your own submissions',
        });
      }
    } else {
      // Cosplayer sees approved only
      if (listing.status !== 'approved') {
        res.status(403).json({
          error: 'forbidden',
          message: 'You can only view approved listings',
        });
      }
    }

    res.json({ listing });
  })
);

/**
 * POST /calendar
 * Create new listing
 * - Staff -> status pending
 * - Head -> status approved (auto-approved)
 * Server derives role + department from logged-in user, ignores client values
 */
calendarRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
    }

    // Guard: must be staff or head organizer
    if (user!.organizer_role !== 'staff' && user!.organizer_role !== 'head') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only staff or Head Organizers can submit listings',
      });
    }

    const { title, organizer_name, venue_name, city, start_date, end_date, description, external_link } = req.body;

    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 100) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Title must be 3-100 characters',
      });
    }

    if (!organizer_name || typeof organizer_name !== 'string' || organizer_name.trim().length === 0) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Organizer name is required',
      });
    }

    if (!venue_name || typeof venue_name !== 'string' || venue_name.trim().length === 0) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Venue name is required',
      });
    }

    if (!city || typeof city !== 'string' || city.trim().length === 0) {
      res.status(400).json({
        error: 'validation_error',
        message: 'City is required',
      });
    }

    if (!start_date || typeof start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Start date must be YYYY-MM-DD format',
      });
    }

    // Validate end_date if provided
    if (end_date !== null && end_date !== undefined && end_date !== '') {
      if (typeof end_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
        res.status(400).json({
          error: 'validation_error',
          message: 'End date must be YYYY-MM-DD format',
        });
      }
      if (end_date < start_date) {
        res.status(400).json({
          error: 'validation_error',
          message: 'End date must be on or after start date',
        });
      }
    }

    // Validate description length
    if (description && typeof description === 'string' && description.length > 500) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Description must be 500 characters or less',
      });
    }

    // Validate external_link format
    if (external_link && typeof external_link === 'string' && external_link.trim() !== '') {
      if (!isPlausibleUrl(external_link)) {
        res.status(400).json({
          error: 'validation_error',
          message: 'External link must be a valid URL',
        });
      }
    }

    // Server determines status based on user role (ignore client input)
    const status = user!.organizer_role === 'head' ? 'approved' : 'pending';

    const created = await query(
      `INSERT INTO public_event_listings (
         title, organizer_name, venue_name, city, start_date, end_date,
         description, external_link,
         submitted_by_user_id, submitted_by_department, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        title.trim(),
        organizer_name.trim(),
        venue_name.trim(),
        city.trim(),
        start_date,
        end_date && end_date.trim() !== '' ? end_date : null,
        description && description.trim() !== '' ? description.trim() : null,
        external_link && external_link.trim() !== '' ? external_link.trim() : null,
        user!.user_id,
        user!.organizer_role === 'staff' ? user!.department : null,
        status,
      ]
    );

    res.status(201).json({
      listing: {
        ...created[0],
        submitted_by_name: user!.display_name,
      },
    });
  })
);

/**
 * PUT /calendar/:id
 * Update listing
 * - Original submitter or any Head can edit
 * - If staff edits approved/rejected entry -> back to pending
 */
calendarRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
    }

    const { id } = req.params;
    const { title, organizer_name, venue_name, city, start_date, end_date, description, external_link } = req.body;

    // Fetch existing listing
    const existing = await query(
      `SELECT * FROM public_event_listings WHERE id = $1`,
      [id]
    );

    if (existing.length === 0) {
      res.status(404).json({
        error: 'not_found',
        message: 'Listing not found',
      });
    }

    const listing = existing[0];

    // Guard: only original submitter or Head
    if (user!.organizer_role !== 'head' && listing.submitted_by_user_id !== user!.user_id) {
      res.status(403).json({
        error: 'forbidden',
        message: 'You can only edit your own listings',
      });
    }

    // Validate title if provided
    if (title !== undefined) {
      if (!title || typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 100) {
        res.status(400).json({
          error: 'validation_error',
          message: 'Title must be 3-100 characters',
        });
      }
    }

    // Validate dates if provided
    const newStartDate = start_date !== undefined ? start_date : listing.start_date;
    const newEndDate = end_date !== undefined ? (end_date === null || end_date === '' ? null : end_date) : listing.end_date;

    if (start_date !== undefined && (typeof start_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start_date))) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Start date must be YYYY-MM-DD format',
      });
    }

    if (newEndDate && (typeof newEndDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(newEndDate))) {
      res.status(400).json({
        error: 'validation_error',
        message: 'End date must be YYYY-MM-DD format',
      });
    }

    if (newEndDate && newEndDate < newStartDate) {
      res.status(400).json({
        error: 'validation_error',
        message: 'End date must be on or after start date',
      });
    }

    // Validate description if provided
    if (description !== undefined && description && typeof description === 'string' && description.length > 500) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Description must be 500 characters or less',
      });
    }

    // Validate external_link if provided
    if (external_link !== undefined && external_link && typeof external_link === 'string' && external_link.trim() !== '') {
      if (!isPlausibleUrl(external_link)) {
        res.status(400).json({
          error: 'validation_error',
          message: 'External link must be a valid URL',
        });
      }
    }

    // If staff edits approved/rejected entry -> back to pending
    let newStatus = listing.status;
    if (user!.organizer_role === 'staff' && (listing.status === 'approved' || listing.status === 'rejected')) {
      newStatus = 'pending';
    }

    const updated = await query(
      `UPDATE public_event_listings
          SET title = COALESCE($1, title),
              organizer_name = COALESCE($2, organizer_name),
              venue_name = COALESCE($3, venue_name),
              city = COALESCE($4, city),
              start_date = COALESCE($5, start_date),
              end_date = COALESCE($6, end_date),
              description = COALESCE($7, description),
              external_link = COALESCE($8, external_link),
              status = $9,
              updated_at = NOW()
        WHERE id = $10
        RETURNING *`,
      [
        title ? title.trim() : null,
        organizer_name ? organizer_name.trim() : null,
        venue_name ? venue_name.trim() : null,
        city ? city.trim() : null,
        start_date || null,
        end_date !== undefined ? (end_date === null || end_date === '' ? null : end_date) : undefined,
        description !== undefined ? (description && description.trim() !== '' ? description.trim() : null) : undefined,
        external_link !== undefined ? (external_link && external_link.trim() !== '' ? external_link.trim() : null) : undefined,
        newStatus,
        id,
      ]
    );

    res.json({ listing: updated[0] });
  })
);

/**
 * PATCH /calendar/:id/review
 * Approve or reject listing (Head only, department-scoped)
 * Body: { decision: 'approve' | 'reject', rejection_reason?: string }
 */
calendarRouter.patch(
  '/:id/review',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
    }

    // Guard: Head only
    if (user!.organizer_role !== 'head') {
      res.status(403).json({
        error: 'forbidden',
        message: 'Only Head Organizers can review listings',
      });
    }

    const { id } = req.params;
    const { decision, rejection_reason } = req.body;

    if (!decision || !['approve', 'reject'].includes(decision)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'decision must be approve or reject',
      });
    }

    if (decision === 'reject' && (!rejection_reason || typeof rejection_reason !== 'string' || rejection_reason.trim() === '')) {
      res.status(400).json({
        error: 'validation_error',
        message: 'rejection_reason is required when rejecting',
      });
    }

    // Fetch listing
    const listings = await query(
      `SELECT * FROM public_event_listings WHERE id = $1`,
      [id]
    );

    if (listings.length === 0) {
      res.status(404).json({
        error: 'not_found',
        message: 'Listing not found',
      });
    }

    const listing = listings[0];

    // Department scope: Head can only review submissions from their own department
    if (listing.submitted_by_department && listing.submitted_by_department !== user!.department) {
      res.status(403).json({
        error: 'forbidden',
        message: 'You can only review listings from your own department',
      });
    }

    if (listing.status !== 'pending') {
      res.status(400).json({
        error: 'validation_error',
        message: 'Listing is not pending review',
      });
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected';

    const updated = await query(
      `UPDATE public_event_listings
          SET status = $1,
              reviewed_by_user_id = $2,
              reviewed_at = NOW(),
              rejection_reason = $3,
              updated_at = NOW()
        WHERE id = $4
        RETURNING *`,
      [
        newStatus,
        user!.user_id,
        decision === 'reject' ? rejection_reason.trim() : null,
        id,
      ]
    );

    res.json({ listing: updated[0] });
  })
);

/**
 * DELETE /calendar/:id
 * Delete listing
 * - Original submitter or any Head can delete
 */
calendarRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await resolveSession(req);
    if (!user) {
      res.status(401).json({
        error: 'invalid_session',
        message: 'Missing, unknown, or expired session',
      });
    }

    const { id } = req.params;

    // Fetch listing
    const existing = await query(
      `SELECT * FROM public_event_listings WHERE id = $1`,
      [id]
    );

    if (existing.length === 0) {
      res.status(404).json({
        error: 'not_found',
        message: 'Listing not found',
      });
    }

    const listing = existing[0];

    // Guard: only original submitter or Head
    if (user!.organizer_role !== 'head' && listing.submitted_by_user_id !== user!.user_id) {
      res.status(403).json({
        error: 'forbidden',
        message: 'You can only delete your own listings',
      });
    }

    await query(`DELETE FROM public_event_listings WHERE id = $1`, [id]);

    res.json({ success: true });
  })
);

/**
 * Error handler for calendar routes
 */
calendarRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const classification = classifyDbError(err);
  const requestId = generateRequestId();

  console.error(`[calendar] error [${requestId}]: ${classification.logReason} - ${err.message}`);

  res.status(classification.httpStatus).json({
    error: classification.errorCode,
    message: classification.clientMessage,
  });
});






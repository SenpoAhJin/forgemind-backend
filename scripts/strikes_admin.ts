/**
 * Admin tool for managing marketplace strikes and bans.
 * 
 * Usage:
 *   npx tsx scripts/strikes_admin.ts list
 *   npx tsx scripts/strikes_admin.ts show <userId>
 *   npx tsx scripts/strikes_admin.ts reset <userId>
 *   npx tsx scripts/strikes_admin.ts unban <userId>
 */

import { pool } from '../src/db';

async function main() {
  const [,, command, userId] = process.argv;

  if (!command) {
    console.error('Usage: npx tsx scripts/strikes_admin.ts <command> [userId]');
    console.error('Commands: list, show <userId>, reset <userId>, unban <userId>');
    process.exit(1);
  }

  try {
    if (command === 'list') {
      await listStats();
    } else if (command === 'show' && userId) {
      await showUser(userId);
    } else if (command === 'reset' && userId) {
      await resetUser(userId);
    } else if (command === 'unban' && userId) {
      await unbanUser(userId);
    } else {
      console.error('Unknown command or missing userId');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function listStats() {
  const result = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE strike_count > 0) as users_with_strikes,
      COUNT(*) FILTER (WHERE posting_locked_until > NOW()) as locked_now,
      COUNT(*) FILTER (WHERE banned_at IS NOT NULL) as banned
    FROM marketplace_user_status
  `);

  const stats = result.rows[0];
  console.log('Marketplace Strike Statistics:');
  console.log(`  Users with strikes: ${stats.users_with_strikes}`);
  console.log(`  Currently locked: ${stats.locked_now}`);
  console.log(`  Banned: ${stats.banned}`);
}

async function showUser(userId: string) {
  const statusResult = await pool.query(
    `SELECT strike_count, posting_locked_until, banned_at
     FROM marketplace_user_status
     WHERE user_id = $1`,
    [userId]
  );

  if (statusResult.rows.length === 0) {
    console.log(`User ${userId}: no strikes`);
    return;
  }

  const status = statusResult.rows[0];
  console.log(`User ${userId}:`);
  console.log(`  Strike count: ${status.strike_count}`);
  console.log(`  Locked until: ${status.posting_locked_until || 'none'}`);
  console.log(`  Banned at: ${status.banned_at || 'not banned'}`);

  const strikesResult = await pool.query(
    `SELECT kind, code, created_at
     FROM marketplace_strikes
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );

  if (strikesResult.rows.length > 0) {
    console.log('  Strikes:');
    for (const strike of strikesResult.rows) {
      console.log(`    ${strike.created_at.toISOString()} - ${strike.kind} - ${strike.code}`);
    }
  }
}

async function resetUser(userId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear strikes
    await client.query(
      `DELETE FROM marketplace_strikes WHERE user_id = $1`,
      [userId]
    );

    // Clear status
    await client.query(
      `UPDATE marketplace_user_status
       SET strike_count = 0,
           posting_locked_until = NULL,
           banned_at = NULL,
           ban_reason = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );

    // Note: does NOT restore active listings

    await client.query('COMMIT');
    console.log(`Reset strikes for user ${userId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function unbanUser(userId: string) {
  const result = await pool.query(
    `UPDATE marketplace_user_status
     SET banned_at = NULL,
         ban_reason = NULL,
         strike_count = 5,
         posting_locked_until = NULL,
         updated_at = NOW()
     WHERE user_id = $1
     RETURNING strike_count`,
    [userId]
  );

  if (result.rowCount === 0) {
    console.log(`User ${userId} not found in strike system`);
  } else {
    console.log(`Unbanned user ${userId}, strike count remains at 5`);
  }
}

main();

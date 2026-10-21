/**
 * Remove duplicate 022_fix_021_rollback_order migration entry
 */
import { query } from '../dist/db';

(async () => {
  try {
    await query(
      `DELETE FROM pgmigrations WHERE name = '022_fix_021_rollback_order'`
    );
    console.log('✓ Removed 022_fix_021_rollback_order from migration history');
    
    const remaining = await query(
      `SELECT name FROM pgmigrations WHERE name LIKE '022%' ORDER BY name`
    );
    console.log('Remaining 022 migrations:', remaining.map(r => r.name));
    
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();

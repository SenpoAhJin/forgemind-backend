/**
 * Migration 015: Marketplace Categories
 *
 * Adds "Costumes & Cosplay" and "Props & Accessories".
 * Marks "Other" as inactive.
 */

exports.up = async (pgm) => {
  // Add new categories
  await pgm.sql(`
    INSERT INTO permitted_categories (category_name, is_active)
    VALUES 
      ('Costumes & Cosplay', true),
      ('Props & Accessories', true)
    ON CONFLICT (category_name) DO NOTHING
  `);

  // Mark Other as inactive
  await pgm.sql(`
    UPDATE permitted_categories
    SET is_active = false
    WHERE category_name = 'Other'
  `);
};

exports.down = async (pgm) => {
  // Remove added categories
  await pgm.sql(`
    DELETE FROM permitted_categories
    WHERE category_name IN ('Costumes & Cosplay', 'Props & Accessories')
  `);

  // Reactivate Other
  await pgm.sql(`
    UPDATE permitted_categories
    SET is_active = true
    WHERE category_name = 'Other'
  `);
};

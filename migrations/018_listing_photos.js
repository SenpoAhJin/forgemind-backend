/**
 * Migration 018: listing_photos table
 * 
 * Real photo upload for marketplace listings. Photos are stored on disk
 * (uploads/listings/) with UUID names; DB holds only relative paths.
 */

exports.up = async (pgm) => {
  pgm.createTable('listing_photos', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    listing_id: { type: 'uuid', references: 'listings(listing_id)', onDelete: 'CASCADE' },
    owner_user_id: { type: 'uuid', notNull: true, references: 'users(user_id)' },
    file_path: { type: 'text', notNull: true },
    mime: { type: 'text', notNull: true },
    size_bytes: { type: 'integer', notNull: true },
    position: { type: 'smallint' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('NOW()') },
    attached_at: { type: 'timestamptz' },
  });

  pgm.createIndex('listing_photos', 'listing_id', { name: 'idx_listing_photos_listing' });
  pgm.createIndex('listing_photos', ['owner_user_id', 'listing_id'], {
    name: 'idx_listing_photos_pending',
    where: 'listing_id IS NULL',
  });
};

exports.down = async (pgm) => {
  pgm.dropTable('listing_photos', { ifExists: true, cascade: true });
};

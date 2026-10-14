-- Migration 021: Drop users.body_size_slider column
-- Created: October 14, 2026
-- Reason: Body-size slider feature cancelled, field no longer used
-- 
-- DO NOT RUN until confirmed by manual DB inspection that:
-- 1. Column actually exists in database (not just in old schema docs)
-- 2. No active code reads or writes this column (already verified: none found)
-- 3. Database backup is current
--
-- Run with: psql -d forgemind -f 021_drop_users_body_size_slider.sql

ALTER TABLE users DROP COLUMN IF EXISTS body_size_slider;

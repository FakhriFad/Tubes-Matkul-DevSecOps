/**
 * Seed script — creates the default admin account if it doesn't exist.
 * Run automatically by index.js after schema.sql is applied.
 * Uses the real bcrypt so the password hash is always correct.
 */
'use strict';

const bcrypt = require('bcrypt');
const logger = require('../config/logger');

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || 'admin@shop.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';
const ADMIN_NAME     = 'System Admin';
const SALT_ROUNDS    = 12;

async function seedAdmin(db) {
  try {
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [ADMIN_EMAIL]
    );

    if (existing.rows.length > 0) {
      logger.info('Admin account already exists — skipping seed');
      return;
    }

    const hash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
    await db.query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'admin')`,
      [ADMIN_EMAIL, hash, ADMIN_NAME]
    );

    logger.info(`Admin account created: ${ADMIN_EMAIL}`);
  } catch (err) {
    logger.error('Admin seed failed', { message: err.message });
  }
}

module.exports = { seedAdmin };

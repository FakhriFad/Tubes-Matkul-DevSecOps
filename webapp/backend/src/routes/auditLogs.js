const logger = require('../config/logger');
const express = require('express');
const { query, validationResult } = require('express-validator');

const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { requireRole }  = require('../middleware/rbac');

const router = express.Router();

// ── GET /api/audit-logs ───────────────────────────────────────────────────────
// Admin only. Supports ?action=LOGIN&limit=30&offset=0
router.get(
  '/',
  authenticate,
  requireRole('admin'),
  [
    query('action').optional().isString().trim().escape(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('offset').optional().isInt({ min: 0 }).toInt(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const limit  = req.query.limit  ?? 30;
    const offset = req.query.offset ?? 0;
    const action = req.query.action || null;

    try {
      const params  = [limit, offset];
      let   where   = '';

      if (action) {
        params.push(action);
        where = `WHERE action = $${params.length}`;
      }

      const result = await db.query(
        `SELECT id, user_id, action, entity, entity_id, ip_address, metadata, created_at
         FROM audit_logs
         ${where}
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      );

      return res.json({ logs: result.rows });
    } catch (err) {
      logger.error('GET /audit-logs error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;

const logger = require('../config/logger');
const express = require('express');
const { body, param, validationResult } = require('express-validator');

const db    = require('../config/db');
const redis = require('../config/redis');
const { authenticate }  = require('../middleware/auth');
const { requireRole }   = require('../middleware/rbac');
const { writeAuditLog } = require('../middleware/auditLog');

const router = express.Router();
const CACHE_TTL = 300; // 5 minutes

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

// ── GET /api/items ────────────────────────────────────────────────────────────
// Public. Cached in Redis.
router.get('/', async (req, res) => {
  try {
    const cacheKey = 'items:all';
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ source: 'cache', items: JSON.parse(cached) });
    }

    const result = await db.query(
      'SELECT id, name, description, price, stock, image_url FROM items WHERE is_active = TRUE ORDER BY created_at DESC'
    );
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result.rows));
    return res.json({ source: 'db', items: result.rows });
  } catch (err) {
    logger.error('GET /items error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/items/:id ────────────────────────────────────────────────────────
router.get('/:id', [param('id').isUUID()], async (req, res) => {
  if (validationErrors(req, res)) return;
  try {
    const cacheKey = `items:${req.params.id}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json({ source: 'cache', item: JSON.parse(cached) });
    }

    const result = await db.query(
      'SELECT id, name, description, price, stock, image_url FROM items WHERE id = $1 AND is_active = TRUE',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(result.rows[0]));
    return res.json({ source: 'db', item: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/items ───────────────────────────────────────────────────────────
// Admin only
router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [
    body('name').trim().notEmpty(),
    body('price').isFloat({ min: 0 }),
    body('stock').isInt({ min: 0 }),
    body('description').optional().trim(),
    body('image_url').optional().isURL(),
  ],
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { name, description, price, stock, image_url } = req.body;
    try {
      const result = await db.query(
        `INSERT INTO items (name, description, price, stock, image_url, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name, description, price, stock, image_url, req.user.id]
      );
      await redis.del('items:all');
      await writeAuditLog({ userId: req.user.id, action: 'CREATE_ITEM', entity: 'items', entityId: result.rows[0].id, req });
      return res.status(201).json({ item: result.rows[0] });
    } catch (err) {
      logger.error('POST /items error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── PUT /api/items/:id ────────────────────────────────────────────────────────
// Admin only
router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  [
    param('id').isUUID(),
    body('name').optional().trim().notEmpty(),
    body('price').optional().isFloat({ min: 0 }),
    body('stock').optional().isInt({ min: 0 }),
    body('description').optional().trim(),
    body('image_url').optional().isURL(),
  ],
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { name, description, price, stock, image_url } = req.body;
    try {
      const existing = await db.query('SELECT id FROM items WHERE id = $1', [req.params.id]);
      if (!existing.rows.length) return res.status(404).json({ error: 'Item not found' });

      const result = await db.query(
        `UPDATE items SET
           name        = COALESCE($1, name),
           description = COALESCE($2, description),
           price       = COALESCE($3, price),
           stock       = COALESCE($4, stock),
           image_url   = COALESCE($5, image_url)
         WHERE id = $6 RETURNING *`,
        [name, description, price, stock, image_url, req.params.id]
      );
      await redis.del('items:all');
      await redis.del(`items:${req.params.id}`);
      await writeAuditLog({ userId: req.user.id, action: 'UPDATE_ITEM', entity: 'items', entityId: req.params.id, req });
      return res.json({ item: result.rows[0] });
    } catch (err) {
      logger.error('PUT /items error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── DELETE /api/items/:id ─────────────────────────────────────────────────────
// Admin only – soft delete
router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  [param('id').isUUID()],
  async (req, res) => {
    if (validationErrors(req, res)) return;
    try {
      const result = await db.query(
        'UPDATE items SET is_active = FALSE WHERE id = $1 RETURNING id',
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });
      await redis.del('items:all');
      await redis.del(`items:${req.params.id}`);
      await writeAuditLog({ userId: req.user.id, action: 'DELETE_ITEM', entity: 'items', entityId: req.params.id, req });
      return res.json({ message: 'Item deleted' });
    } catch (err) {
      logger.error('DELETE /items error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;

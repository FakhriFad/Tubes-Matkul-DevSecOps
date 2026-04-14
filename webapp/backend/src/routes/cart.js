const logger = require('../config/logger');
const express = require('express');
const { body, param, validationResult } = require('express-validator');

const db    = require('../config/db');
const { authenticate }  = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/auditLog');

const router = express.Router();

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

// Helper – get or create active cart for user.
// Uses INSERT … ON CONFLICT to be race-condition-safe: two simultaneous
// requests for the same user will both try to insert; one succeeds, the
// other hits the unique constraint and returns the existing row.
async function getOrCreateCart(userId) {
  const result = await db.query(
    `INSERT INTO carts (user_id, status)
     VALUES ($1, 'active')
     ON CONFLICT (user_id) WHERE status = 'active'
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [userId]
  );
  return result.rows[0].id;
}

// ── GET /api/cart ─────────────────────────────────────────────────────────────
// Returns the current user's active cart with items.
router.get('/', authenticate, async (req, res) => {
  try {
    const cartResult = await db.query(
      "SELECT id, status, created_at FROM carts WHERE user_id = $1 AND status = 'active'",
      [req.user.id]
    );
    if (!cartResult.rows.length) {
      return res.json({ cart: null, items: [] });
    }
    const cart = cartResult.rows[0];

    const itemsResult = await db.query(
      `SELECT ci.id, ci.quantity, ci.unit_price,
              i.id AS item_id, i.name, i.image_url, i.price AS current_price
       FROM cart_items ci
       JOIN items i ON i.id = ci.item_id
       WHERE ci.cart_id = $1`,
      [cart.id]
    );

    const total = itemsResult.rows.reduce((sum, r) => sum + r.quantity * parseFloat(r.unit_price), 0);
    return res.json({ cart: { ...cart, total: total.toFixed(2) }, items: itemsResult.rows });
  } catch (err) {
    logger.error('GET /cart error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/cart/items ──────────────────────────────────────────────────────
// Add an item to cart (or increment quantity if already present)
router.post(
  '/items',
  authenticate,
  [
    body('item_id').isUUID(),
    body('quantity').isInt({ min: 1 }).optional(),
  ],
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { item_id, quantity = 1 } = req.body;

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Validate item exists and has stock
      const itemResult = await client.query(
        'SELECT id, price, stock FROM items WHERE id = $1 AND is_active = TRUE',
        [item_id]
      );
      if (!itemResult.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Item not found' });
      }
      const item = itemResult.rows[0];

      if (item.stock < quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Insufficient stock. Available: ${item.stock}` });
      }

      const cartId = await getOrCreateCart(req.user.id);

      // Upsert cart item
      const existing = await client.query(
        'SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND item_id = $2',
        [cartId, item_id]
      );

      let cartItem;
      if (existing.rows.length) {
        const newQty = existing.rows[0].quantity + quantity;
        if (item.stock < newQty) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Insufficient stock. Available: ${item.stock}` });
        }
        const updated = await client.query(
          'UPDATE cart_items SET quantity = $1 WHERE id = $2 RETURNING *',
          [newQty, existing.rows[0].id]
        );
        cartItem = updated.rows[0];
      } else {
        const inserted = await client.query(
          'INSERT INTO cart_items (cart_id, item_id, quantity, unit_price) VALUES ($1, $2, $3, $4) RETURNING *',
          [cartId, item_id, quantity, item.price]
        );
        cartItem = inserted.rows[0];
      }

      await client.query('COMMIT');
      await writeAuditLog({ userId: req.user.id, action: 'ADD_TO_CART', entity: 'cart_items', entityId: cartItem.id, req, metadata: { item_id, quantity } });
      return res.status(201).json({ cart_item: cartItem });
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('POST /cart/items error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  }
);

// ── PATCH /api/cart/items/:id ─────────────────────────────────────────────────
// Update quantity of a cart item
router.patch(
  '/items/:id',
  authenticate,
  [param('id').isUUID(), body('quantity').isInt({ min: 1 })],
  async (req, res) => {
    if (validationErrors(req, res)) return;
    const { quantity } = req.body;

    try {
      // Ensure item belongs to this user's cart
      const result = await db.query(
        `SELECT ci.id, ci.item_id FROM cart_items ci
         JOIN carts c ON c.id = ci.cart_id
         WHERE ci.id = $1 AND c.user_id = $2 AND c.status = 'active'`,
        [req.params.id, req.user.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Cart item not found' });

      // Check stock
      const stockResult = await db.query('SELECT stock FROM items WHERE id = $1', [result.rows[0].item_id]);
      if (stockResult.rows[0].stock < quantity) {
        return res.status(400).json({ error: `Insufficient stock. Available: ${stockResult.rows[0].stock}` });
      }

      const updated = await db.query(
        'UPDATE cart_items SET quantity = $1 WHERE id = $2 RETURNING *',
        [quantity, req.params.id]
      );
      await writeAuditLog({ userId: req.user.id, action: 'UPDATE_CART_ITEM', entity: 'cart_items', entityId: req.params.id, req, metadata: { quantity } });
      return res.json({ cart_item: updated.rows[0] });
    } catch (err) {
      logger.error('PATCH /cart/items error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── DELETE /api/cart/items/:id ────────────────────────────────────────────────
router.delete(
  '/items/:id',
  authenticate,
  [param('id').isUUID()],
  async (req, res) => {
    if (validationErrors(req, res)) return;
    try {
      const result = await db.query(
        `DELETE FROM cart_items ci
         USING carts c
         WHERE ci.cart_id = c.id AND ci.id = $1 AND c.user_id = $2 AND c.status = 'active'
         RETURNING ci.id`,
        [req.params.id, req.user.id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Cart item not found' });
      await writeAuditLog({ userId: req.user.id, action: 'REMOVE_FROM_CART', entity: 'cart_items', entityId: req.params.id, req });
      return res.json({ message: 'Item removed from cart' });
    } catch (err) {
      logger.error('DELETE /cart/items error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/cart/checkout ───────────────────────────────────────────────────
router.post('/checkout', authenticate, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const cartResult = await client.query(
      "SELECT id FROM carts WHERE user_id = $1 AND status = 'active'",
      [req.user.id]
    );
    if (!cartResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No active cart' });
    }
    const cartId = cartResult.rows[0].id;

    const items = await client.query(
      'SELECT ci.item_id, ci.quantity FROM cart_items ci WHERE ci.cart_id = $1',
      [cartId]
    );
    if (!items.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart is empty' });
    }

    // Deduct stock
    for (const ci of items.rows) {
      const upd = await client.query(
        'UPDATE items SET stock = stock - $1 WHERE id = $2 AND stock >= $1 RETURNING id',
        [ci.quantity, ci.item_id]
      );
      if (!upd.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Insufficient stock for item ${ci.item_id}` });
      }
    }

    await client.query(
      "UPDATE carts SET status = 'checked_out' WHERE id = $1",
      [cartId]
    );

    await client.query('COMMIT');
    await writeAuditLog({ userId: req.user.id, action: 'CHECKOUT', entity: 'carts', entityId: cartId, req });
    return res.json({ message: 'Checkout successful', cart_id: cartId });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Checkout error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;

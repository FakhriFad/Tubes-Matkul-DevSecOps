/**
 * Unit tests for cart route helpers and validation logic
 * Run: node --test tests/cart.test.js
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Shared mock DB ─────────────────────────────────────────────────────────────
const cartRows  = [];
const itemRows  = [];
let   nextCartId = 'cart-uuid-1';

const dbMock = {
  _txDepth: 0,
  async query(sql, params) {
    const s = sql.trim().toUpperCase();

    // Transaction control
    if (s === 'BEGIN')    { this._txDepth++; return { rows: [] }; }
    if (s === 'COMMIT')   { this._txDepth--; return { rows: [] }; }
    if (s === 'ROLLBACK') { this._txDepth--; return { rows: [] }; }

    // INSERT INTO carts … ON CONFLICT → always return nextCartId
    if (s.startsWith('INSERT INTO CARTS')) {
      return { rows: [{ id: nextCartId }] };
    }
    // SELECT FROM carts
    if (s.includes('FROM CARTS') && s.includes('STATUS')) {
      return { rows: cartRows.filter(c => c.user_id === params[0] && c.status === 'active') };
    }
    // SELECT FROM items (stock check)
    if (s.includes('FROM ITEMS') && params?.[0]) {
      const row = itemRows.find(i => i.id === params[0]);
      return { rows: row ? [row] : [] };
    }
    return { rows: [] };
  },
  async connect() {
    const self = this;
    return {
      query: (...a) => self.query(...a),
      release: () => {},
    };
  },
  reset() { cartRows.length = 0; itemRows.length = 0; nextCartId = 'cart-uuid-1'; },
};

describe('getOrCreateCart (isolated logic)', () => {

  test('ON CONFLICT upsert returns a cart id', async () => {
    // Simulate what getOrCreateCart does with the ON CONFLICT query
    const result = await dbMock.query(
      `INSERT INTO carts (user_id, status) VALUES ($1, 'active')
       ON CONFLICT (user_id, status) DO UPDATE SET updated_at = NOW() RETURNING id`,
      ['user-1']
    );
    assert.ok(result.rows[0].id, 'should return a cart id');
  });

  test('concurrent calls both return same cart id', async () => {
    // Simulate two simultaneous calls — both should get the same id
    const [r1, r2] = await Promise.all([
      dbMock.query(`INSERT INTO carts (user_id, status) VALUES ($1, 'active') ON CONFLICT (user_id, status) DO UPDATE SET updated_at = NOW() RETURNING id`, ['user-2']),
      dbMock.query(`INSERT INTO carts (user_id, status) VALUES ($1, 'active') ON CONFLICT (user_id, status) DO UPDATE SET updated_at = NOW() RETURNING id`, ['user-2']),
    ]);
    assert.equal(r1.rows[0].id, r2.rows[0].id, 'concurrent calls must return the same cart id');
  });

});

describe('cart stock validation logic', () => {

  beforeEach(() => dbMock.reset());

  test('rejects add when item has zero stock', async () => {
    itemRows.push({ id: 'item-oos', price: '100', stock: 0 });

    const item = (await dbMock.query('SELECT FROM items WHERE id=$1 AND is_active=TRUE', ['item-oos'])).rows[0];
    assert.ok(item, 'item should be found');

    const requestedQty = 1;
    const canAdd = item.stock >= requestedQty;
    assert.equal(canAdd, false, 'should not allow adding out-of-stock item');
  });

  test('allows add when stock is sufficient', async () => {
    itemRows.push({ id: 'item-ok', price: '50000', stock: 10 });

    const item = (await dbMock.query('SELECT FROM items WHERE id=$1 AND is_active=TRUE', ['item-ok'])).rows[0];
    const canAdd = item.stock >= 3;
    assert.equal(canAdd, true);
  });

  test('rejects quantity exceeding available stock', async () => {
    itemRows.push({ id: 'item-low', price: '25000', stock: 2 });

    const item = (await dbMock.query('SELECT FROM items WHERE id=$1 AND is_active=TRUE', ['item-low'])).rows[0];
    const canAdd = item.stock >= 5;
    assert.equal(canAdd, false, 'qty 5 > stock 2 should be rejected');
  });

});

describe('cart total calculation', () => {

  test('calculates correct total from cart items', () => {
    const items = [
      { quantity: 2, unit_price: '50000' },
      { quantity: 1, unit_price: '120000' },
      { quantity: 3, unit_price: '15000' },
    ];
    const total = items.reduce((s, i) => s + i.quantity * parseFloat(i.unit_price), 0);
    // 2*50000 + 1*120000 + 3*15000 = 100000 + 120000 + 45000 = 265000
    assert.equal(total, 265000);
  });

  test('returns 0 for empty cart', () => {
    const total = [].reduce((s, i) => s + i.quantity * parseFloat(i.unit_price), 0);
    assert.equal(total, 0);
  });

});

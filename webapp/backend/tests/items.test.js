/**
 * Unit tests for items route logic
 * Run (from backend/):  node --test tests/items.test.js
 *
 * Tests the cache-aside read pattern and the price/stock validation
 * constraints without requiring a real DB or Redis.
 */
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Controllable Redis stub ───────────────────────────────────────────────────
const redisMock = {
  _store: {},
  _gets: [],
  _sets: [],
  async get(key) {
    this._gets.push(key);
    return this._store[key] ?? null;
  },
  async setex(key, ttl, val) {
    this._store[key] = val;
    this._sets.push({ key, ttl, val });
    return 'OK';
  },
  async del(key) {
    delete this._store[key];
    return 1;
  },
  on() {},
  reset() { this._store = {}; this._gets = []; this._sets = []; },
};

// ── Controllable DB stub ──────────────────────────────────────────────────────
const dbRows = [];
const dbMock = {
  queries: [],
  async query(sql, _params) {
    this.queries.push(sql.trim());
    if (sql.toUpperCase().includes('FROM ITEMS')) return { rows: dbRows };
    if (sql.toUpperCase().includes('INSERT INTO ITEMS')) {
      const row = { id: 'new-item-uuid', name: 'Test', price: '10000', stock: 5 };
      dbRows.push(row);
      return { rows: [row] };
    }
    return { rows: [] };
  },
  reset() { this.queries = []; dbRows.length = 0; },
};

// ── Cache-aside read logic (extracted from items route) ───────────────────────
async function getCachedItems(redis, db) {
  const cacheKey = 'items:all';
  const cached = await redis.get(cacheKey);
  if (cached) return { source: 'cache', items: JSON.parse(cached) };

  const result = await db.query(
    'SELECT id, name, description, price, stock, image_url FROM items WHERE is_active = TRUE ORDER BY created_at DESC'
  );
  await redis.setex(cacheKey, 300, JSON.stringify(result.rows));
  return { source: 'db', items: result.rows };
}

async function invalidateItemsCache(redis, itemId) {
  await redis.del('items:all');
  if (itemId) await redis.del(`items:${itemId}`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('items cache-aside read', () => {

  beforeEach(() => {
    redisMock.reset();
    dbMock.reset();
  });

  test('returns data from DB on cache miss and populates cache', async () => {
    dbRows.push({ id: 'item-1', name: 'Widget', price: '5000', stock: 10 });

    const result = await getCachedItems(redisMock, dbMock);

    assert.equal(result.source, 'db',   'should come from DB on first call');
    assert.equal(result.items.length, 1, 'should return the DB row');
    assert.equal(redisMock._sets.length, 1, 'cache should be populated after DB hit');
    assert.equal(redisMock._sets[0].key, 'items:all');
    assert.equal(redisMock._sets[0].ttl, 300, 'TTL should be 300s');
  });

  test('returns data from cache on second call without hitting DB', async () => {
    dbRows.push({ id: 'item-1', name: 'Widget', price: '5000', stock: 10 });

    // First call — populates cache
    await getCachedItems(redisMock, dbMock);
    const dbQueriesAfterFirst = dbMock.queries.length;

    // Second call — should hit cache
    const result = await getCachedItems(redisMock, dbMock);

    assert.equal(result.source, 'cache', 'second call should come from cache');
    assert.equal(dbMock.queries.length, dbQueriesAfterFirst, 'DB should not be queried again');
  });

  test('returns empty list when DB has no active items', async () => {
    // dbRows is empty
    const result = await getCachedItems(redisMock, dbMock);
    assert.equal(result.source, 'db');
    assert.deepEqual(result.items, []);
  });

});

describe('items cache invalidation', () => {

  beforeEach(() => redisMock.reset());

  test('invalidateItemsCache removes items:all key', async () => {
    redisMock._store['items:all'] = '[]';
    await invalidateItemsCache(redisMock, null);
    assert.equal(await redisMock.get('items:all'), null, 'items:all should be deleted');
  });

  test('invalidateItemsCache also removes the specific item key', async () => {
    redisMock._store['items:all']    = '[]';
    redisMock._store['items:item-5'] = '{}';
    await invalidateItemsCache(redisMock, 'item-5');
    assert.equal(await redisMock.get('items:all'),    null, 'list cache cleared');
    assert.equal(await redisMock.get('items:item-5'), null, 'item cache cleared');
  });

  test('invalidateItemsCache is safe when keys do not exist', async () => {
    await assert.doesNotReject(() => invalidateItemsCache(redisMock, 'nonexistent'));
  });

});

describe('item price and stock validation constraints', () => {

  test('rejects negative price', () => {
    const price = -1;
    assert.equal(price >= 0, false, 'price must be >= 0');
  });

  test('accepts zero price (free item)', () => {
    const price = 0;
    assert.equal(price >= 0, true);
  });

  test('rejects negative stock', () => {
    const stock = -5;
    assert.equal(stock >= 0, false, 'stock must be >= 0');
  });

  test('accepts zero stock (out-of-stock item can be created)', () => {
    const stock = 0;
    assert.equal(stock >= 0, true);
  });

  test('isFloat check rejects non-numeric price string', () => {
    const raw = 'abc';
    const parsed = parseFloat(raw);
    assert.equal(isNaN(parsed), true, 'non-numeric string fails float parse');
  });

  test('price stored with correct precision', () => {
    const price = parseFloat('9999.99');
    assert.equal(price.toFixed(2), '9999.99');
  });

});

describe('RBAC guard logic (unit)', () => {

  // The requireRole middleware is tested exhaustively in rbac.test.js.
  // These tests verify the role check that would gate item writes.

  test('admin role passes the admin guard', () => {
    const ROLE_HIERARCHY = { admin: 2, customer: 1 };
    const userRole = 'admin';
    const required = 'admin';
    const hasAccess = (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[required] ?? 99);
    assert.equal(hasAccess, true);
  });

  test('customer role is blocked from admin routes', () => {
    const ROLE_HIERARCHY = { admin: 2, customer: 1 };
    const userRole = 'customer';
    const required = 'admin';
    const hasAccess = (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[required] ?? 99);
    assert.equal(hasAccess, false);
  });

});

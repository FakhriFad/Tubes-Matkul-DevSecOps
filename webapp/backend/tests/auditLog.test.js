/**
 * Unit tests for audit log middleware
 * Run: node --test tests/auditLog.test.js
 */
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ── Mock db ───────────────────────────────────────────────────────────────────
const dbMock = {
  queries: [],
  async query(sql, params) {
    this.queries.push({ sql, params });
    return { rows: [] };
  },
  reset() { this.queries = []; },
};

require.cache[require.resolve('../src/config/db')] = {
  id: 'db', filename: 'db', loaded: true,
  exports: dbMock,
};

// Mock logger to suppress output during tests
require.cache[require.resolve('../src/config/logger')] = {
  id: 'logger', filename: 'logger', loaded: true,
  exports: { info: () => {}, error: () => {}, warn: () => {}, http: () => {} },
};

const { writeAuditLog, auditMiddleware } = require('../src/middleware/auditLog');

const fakeReq = (method = 'POST', path = '/api/items') => ({
  method,
  path,
  ip: '127.0.0.1',
  params: {},
  headers: { 'user-agent': 'test-agent' },
  user: { id: 'user-uuid' },
});

describe('writeAuditLog', () => {

  beforeEach(() => dbMock.reset());

  test('inserts an audit record with correct fields', async () => {
    const req = fakeReq();
    await writeAuditLog({ userId: 'u1', action: 'LOGIN', entity: 'users', entityId: 'e1', req, metadata: { foo: 'bar' } });

    assert.equal(dbMock.queries.length, 1);
    const { params } = dbMock.queries[0];
    assert.equal(params[0], 'u1',     'userId');
    assert.equal(params[1], 'LOGIN',  'action');
    assert.equal(params[2], 'users',  'entity');
    assert.equal(params[3], 'e1',     'entityId');
    assert.equal(params[4], '127.0.0.1', 'ip');
    assert.equal(params[5], 'test-agent', 'user-agent');
    assert.ok(params[6].includes('foo'),  'metadata JSON');
  });

  test('handles null userId gracefully', async () => {
    await writeAuditLog({ userId: null, action: 'REGISTER', entity: 'users', req: fakeReq() });
    assert.equal(dbMock.queries.length, 1);
    assert.equal(dbMock.queries[0].params[0], null);
  });

  test('does not throw when db.query rejects', async () => {
    dbMock.query = async () => { throw new Error('DB down'); };
    // Should swallow the error without propagating
    await assert.doesNotReject(() =>
      writeAuditLog({ userId: 'u', action: 'TEST', req: fakeReq() })
    );
    // Restore
    dbMock.query = async function(sql, params) {
      this.queries.push({ sql, params }); return { rows: [] };
    };
  });

});

describe('auditMiddleware', () => {

  beforeEach(() => dbMock.reset());

  test('calls next() immediately', () => {
    const req = fakeReq();
    const res = { json: (b) => b };
    let called = false;
    auditMiddleware(req, res, () => { called = true; });
    assert.equal(called, true);
  });

  test('logs mutating requests after response', async () => {
    const req = { ...fakeReq('POST', '/api/items'), user: { id: 'uid' }, params: {} };
    const res = { statusCode: 201, json: (b) => b };   // real function – middleware wraps it
    auditMiddleware(req, res, () => {});

    // Call the now-wrapped json to trigger the audit write
    await new Promise(resolve => {
      res.json({ id: '123' });
      setImmediate(resolve);
    });

    assert.equal(dbMock.queries.length, 1, 'audit log entry should be written');
  });

  test('does not log GET requests', async () => {
    const req = { ...fakeReq('GET', '/api/items'), user: { id: 'uid' }, params: {} };
    const res = { statusCode: 200, json: (b) => b };   // real function
    auditMiddleware(req, res, () => {});
    res.json({});
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(dbMock.queries.length, 0, 'GET should not produce an audit entry');
  });

  test('does not log failed requests (4xx)', async () => {
    const req = { ...fakeReq('POST', '/api/items'), user: { id: 'uid' }, params: {} };
    const res = { statusCode: 422, json: (b) => b };   // real function
    auditMiddleware(req, res, () => {});
    res.json({ error: 'bad input' });
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(dbMock.queries.length, 0, '4xx should not produce an audit entry');
  });

});

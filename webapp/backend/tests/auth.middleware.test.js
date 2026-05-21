/**
 * Unit tests for JWT auth middleware
 * Run (from backend/):  node --test tests/auth.middleware.test.js
 *
 * Requires stubs to be present: node tests/create-stubs.js
 */
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert  = require('node:assert/strict');
const path    = require('path');

// ── 1. Generate stubs if missing ──────────────────────────────────────────────
const jwtStubPath = path.resolve(__dirname, '../node_modules/jsonwebtoken/index.js');
if (!require('fs').existsSync(jwtStubPath)) {
  require('./create-stubs');
}

// ── 2. Load the stub modules AFTER they exist on disk ─────────────────────────
// We use require() here — Node will find them in node_modules normally.
const jwtStub     = require('jsonwebtoken');
const redisConfig = path.resolve(__dirname, '../src/config/redis.js');
const loggerPath  = path.resolve(__dirname, '../src/config/logger.js');

// Stub logger (suppress output)
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { info: () => {}, warn: () => {}, error: () => {}, http: () => {} },
};

// ── 3. Load the middleware under test ─────────────────────────────────────────
// config/redis.js will now load ioredis stub from node_modules normally.
// auth.js will load jsonwebtoken stub from node_modules normally.
const { authenticate } = require('../src/middleware/auth');

// Get the redis instance so we can control its store in tests
const redisInstance = require('../src/config/redis');

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeReqRes(token) {
  const req = {
    headers: { authorization: token ? `Bearer ${token}` : undefined },
  };
  const res = { _status: null, _body: null };
  res.status = (c) => { res._status = c; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return { req, res };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('authenticate middleware', () => {

  beforeEach(() => {
    // Reset redis store and jwt verify behaviour before each test
    if (redisInstance && redisInstance._store) redisInstance._store = {};
    jwtStub.__reset();
  });

  test('passes valid non-blacklisted token, attaches user + token to req', async () => {
    const { req, res } = makeReqRes('valid-token');
    let called = false;

    await authenticate(req, res, () => { called = true; });

    assert.equal(called, true,       'next() should be called');
    assert.ok(req.user,              'req.user should be populated');
    assert.equal(req.user.id,    'user-1');
    assert.equal(req.user.role,  'customer');
    assert.equal(req.token,      'valid-token', 'original token stored on req');
    assert.equal(res._status,    null,  'should not have set a response status');
  });

  test('rejects request with no Authorization header', async () => {
    const { req, res } = makeReqRes(null);
    let called = false;

    await authenticate(req, res, () => { called = true; });

    assert.equal(called,      false);
    assert.equal(res._status, 401);
    assert.ok(res._body.error);
  });

  test('rejects request with malformed Authorization header', async () => {
    const req = { headers: { authorization: 'Token abc123' } };
    const res = { _status: null, _body: null };
    res.status = (c) => { res._status = c; return res; };
    res.json   = (b) => { res._body   = b; return res; };

    await authenticate(req, res, () => {});

    assert.equal(res._status, 401);
  });

  test('rejects blacklisted token', async () => {
    if (redisInstance && redisInstance._store) {
      redisInstance._store['blacklist:revoked-token'] = '1';
    }

    const { req, res } = makeReqRes('revoked-token');
    let called = false;

    await authenticate(req, res, () => { called = true; });

    assert.equal(called,      false);
    assert.equal(res._status, 401);
    assert.match(res._body.error, /revoked/i);
  });

  test('rejects token that fails jwt.verify', async () => {
    jwtStub.__setVerify(() => { throw new Error('jwt expired'); });
    const { req, res } = makeReqRes('expired-token');
    let called = false;

    await authenticate(req, res, () => { called = true; });

    assert.equal(called,      false);
    assert.equal(res._status, 401);
  });

  test('attaches role from JWT payload to req.user', async () => {
    jwtStub.__setVerify(() => ({ id: 'admin-1', email: 'admin@shop.local', role: 'admin' }));
    const { req, res } = makeReqRes('admin-token');
    let called = false;

    await authenticate(req, res, () => { called = true; });

    assert.equal(called, true);
    assert.equal(req.user.role, 'admin');
  });

  test('non-blacklisted token with no prior Redis key is allowed', async () => {
    const { req, res } = makeReqRes('clean-token');
    let called = false;

    await authenticate(req, res, () => { called = true; });

    assert.equal(called, true);
  });

});

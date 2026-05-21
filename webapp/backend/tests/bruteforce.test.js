/**
 * Unit tests for brute force / account lockout middleware
 * Run: node --test tests/bruteforce.test.js
 */
'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');
const fs     = require('fs');

// Generate stubs if missing
const stubCheck = path.resolve(__dirname, '../node_modules/jsonwebtoken/index.js');
if (!fs.existsSync(stubCheck)) require('./create-stubs');

// ── Stub logger ───────────────────────────────────────────────────────────────
const loggerPath = path.resolve(__dirname, '../src/config/logger.js');
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { info: () => {}, warn: () => {}, error: () => {}, http: () => {} },
};

// ── Stub redis with controllable store ───────────────────────────────────────
const fakeRedis = {
  _store: {},
  async get(k)          { return this._store[k] ?? null; },
  async set(k, v)       { this._store[k] = String(v); return 'OK'; },
  async setex(k, _t, v) { this._store[k] = String(v); return 'OK'; },
  async del(k)          { delete this._store[k]; return 1; },
  async incr(k)         { this._store[k] = String((parseInt(this._store[k] || '0') + 1)); return parseInt(this._store[k]); },
  async expire()        { return 1; },
  on()                  { return this; },
  reset()               { this._store = {}; },
};

const redisPath = path.resolve(__dirname, '../src/config/redis.js');
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true, exports: fakeRedis,
};

const { loginLimiter, recordFailure, recordSuccess, getLockStatus } =
  require('../src/middleware/bruteforce');

// ── Helper to build mock req/res ──────────────────────────────────────────────
function makeCtx(email = 'test@example.com', ip = '1.2.3.4') {
  const req = { body: { email }, ip };
  const res = { _status: null, _body: null };
  res.status = (c) => { res._status = c; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return { req, res };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('recordFailure', () => {

  beforeEach(() => fakeRedis.reset());

  test('increments attempt counter on each call', async () => {
    const r1 = await recordFailure('user@test.com', '1.2.3.4');
    const r2 = await recordFailure('user@test.com', '1.2.3.4');
    const r3 = await recordFailure('user@test.com', '1.2.3.4');

    assert.equal(r1.attempts, 1);
    assert.equal(r2.attempts, 2);
    assert.equal(r3.attempts, 3);
  });

  test('tracks email and IP counters independently', async () => {
    await recordFailure('alice@test.com', '10.0.0.1');
    await recordFailure('bob@test.com',   '10.0.0.1');

    const aliceStatus = await getLockStatus('alice@test.com', '10.0.0.1');
    const bobStatus   = await getLockStatus('bob@test.com',   '10.0.0.1');

    assert.equal(aliceStatus.email_attempts, 1, 'alice should have 1 attempt');
    assert.equal(bobStatus.email_attempts,   1, 'bob should have 1 attempt');
  });

  test('returns remaining attempts count', async () => {
    const maxAttempts = parseInt(process.env.BRUTE_MAX_ATTEMPTS || '5');
    const result = await recordFailure('user@test.com', '1.2.3.4');
    assert.equal(result.remaining, maxAttempts - 1);
  });

});

describe('recordSuccess', () => {

  beforeEach(() => fakeRedis.reset());

  test('resets the failure counter after successful login', async () => {
    // Build up 3 failures
    await recordFailure('user@test.com', '1.2.3.4');
    await recordFailure('user@test.com', '1.2.3.4');
    await recordFailure('user@test.com', '1.2.3.4');

    // Successful login should clear counters
    await recordSuccess('user@test.com', '1.2.3.4');

    const status = await getLockStatus('user@test.com', '1.2.3.4');
    assert.equal(status.email_attempts, 0, 'counter should be reset to 0');
    assert.equal(status.email_locked,   false, 'should not be locked after success');
  });

});

describe('loginLimiter middleware', () => {

  beforeEach(() => fakeRedis.reset());

  test('calls next() when no failed attempts', async () => {
    const { req, res } = makeCtx();
    let called = false;

    await loginLimiter(req, res, () => { called = true; });

    assert.equal(called, true, 'next() should be called when not locked');
    assert.equal(res._status, null);
  });

  test('blocks request and returns 429 after max attempts', async () => {
    const MAX = parseInt(process.env.BRUTE_MAX_ATTEMPTS || '5');
    const email = 'victim@test.com';
    const ip    = '2.3.4.5';

    // Simulate MAX failed attempts
    for (let i = 0; i < MAX; i++) {
      await recordFailure(email, ip);
    }

    const { req, res } = makeCtx(email, ip);
    let called = false;

    await loginLimiter(req, res, () => { called = true; });

    assert.equal(called,       false, 'next() must NOT be called when locked');
    assert.equal(res._status,  429,   'should return 429 Too Many Requests');
    assert.ok(res._body.error,        'error message must be present');
    assert.ok(res._body.locked_until, 'locked_until timestamp must be present');
  });

  test('allows request after counter is reset', async () => {
    const email = 'test@test.com';
    const ip    = '3.4.5.6';
    const MAX   = parseInt(process.env.BRUTE_MAX_ATTEMPTS || '5');

    // Build up max failures
    for (let i = 0; i < MAX; i++) await recordFailure(email, ip);

    // Verify it's locked
    const { req: r1, res: res1 } = makeCtx(email, ip);
    await loginLimiter(r1, res1, () => {});
    assert.equal(res1._status, 429);

    // Reset (simulate successful login from another session)
    await recordSuccess(email, ip);

    // Should now pass through
    const { req: r2, res: res2 } = makeCtx(email, ip);
    let called = false;
    await loginLimiter(r2, res2, () => { called = true; });
    assert.equal(called, true, 'should pass after reset');
  });

  test('handles missing email gracefully (no crash)', async () => {
    const req = { body: {}, ip: '1.2.3.4' };
    const res = { _status: null, _body: null };
    res.status = (c) => { res._status = c; return res; };
    res.json   = (b) => { res._body   = b; return res; };

    await assert.doesNotReject(() =>
      loginLimiter(req, res, () => {})
    );
  });

});

describe('getLockStatus', () => {

  beforeEach(() => fakeRedis.reset());

  test('returns zeros for a clean user', async () => {
    const status = await getLockStatus('new@test.com', '1.1.1.1');
    assert.equal(status.email_attempts, 0);
    assert.equal(status.ip_attempts,    0);
    assert.equal(status.email_locked,   false);
    assert.equal(status.ip_locked,      false);
  });

  test('reports locked: true when attempts reach threshold', async () => {
    const MAX = parseInt(process.env.BRUTE_MAX_ATTEMPTS || '5');
    for (let i = 0; i < MAX; i++) {
      await recordFailure('locked@test.com', '5.5.5.5');
    }
    const status = await getLockStatus('locked@test.com', '5.5.5.5');
    assert.equal(status.email_locked,      true);
    assert.equal(status.remaining_attempts, 0);
  });

});

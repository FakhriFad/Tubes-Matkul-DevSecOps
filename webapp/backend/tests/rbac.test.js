/**
 * Unit tests for RBAC middleware
 * Run: node --test tests/rbac.test.js
 */
const { test, describe, mock } = require('node:test');
const assert = require('node:assert/strict');

const { requireRole } = require('../src/middleware/rbac');

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body;  return res; };
  return res;
}

describe('requireRole middleware', () => {

  test('allows admin to access admin-only route', () => {
    const req  = { user: { id: '1', role: 'admin' } };
    const res  = makeRes();
    let called = false;
    const next = () => { called = true; };

    requireRole('admin')(req, res, next);

    assert.equal(called, true, 'next() should have been called');
    assert.equal(res._status, null, 'should not have set a status code');
  });

  test('allows admin to access customer-level route', () => {
    const req  = { user: { id: '1', role: 'admin' } };
    const res  = makeRes();
    let called = false;
    requireRole('customer')(req, res, () => { called = true; });

    assert.equal(called, true, 'admin should pass customer-level guard');
  });

  test('blocks customer from admin-only route', () => {
    const req  = { user: { id: '2', role: 'customer' } };
    const res  = makeRes();
    let called = false;
    requireRole('admin')(req, res, () => { called = true; });

    assert.equal(called,      false, 'next() must not be called');
    assert.equal(res._status, 403,   'should respond 403');
    assert.ok(res._body.error,       'error message should be present');
  });

  test('blocks unauthenticated request', () => {
    const req  = {};   // no user
    const res  = makeRes();
    let called = false;
    requireRole('customer')(req, res, () => { called = true; });

    assert.equal(called,      false, 'next() must not be called');
    assert.equal(res._status, 401,   'should respond 401');
  });

  test('blocks request with unknown role', () => {
    const req  = { user: { id: '3', role: 'superuser' } };
    const res  = makeRes();
    let called = false;
    requireRole('admin')(req, res, () => { called = true; });

    assert.equal(called,      false, 'next() must not be called');
    assert.equal(res._status, 403);
  });

  test('allows when any one of multiple allowed roles matches', () => {
    const req  = { user: { id: '4', role: 'customer' } };
    const res  = makeRes();
    let called = false;
    requireRole('admin', 'customer')(req, res, () => { called = true; });

    assert.equal(called, true, 'customer is in the allowed list');
  });

});

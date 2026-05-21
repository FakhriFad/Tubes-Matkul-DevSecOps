// Test stub for ioredis – replaced by per-test overrides in the mock cache
class Redis {
  constructor() { this._store = {}; }
  async get(k) { return this._store[k] ?? null; }
  async setex(k, _ttl, v) { this._store[k] = v; }
  on() {}
}
module.exports = Redis;

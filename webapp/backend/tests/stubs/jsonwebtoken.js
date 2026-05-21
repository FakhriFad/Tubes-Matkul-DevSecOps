// Test stub for jsonwebtoken – verify/decode can be overridden per-test
let _verifyImpl = () => ({ id: 'user-1', email: 'a@b.com', role: 'customer' });
module.exports = {
  verify: (...args) => _verifyImpl(...args),
  decode: () => ({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  __setVerify: (fn) => { _verifyImpl = fn; },
  __reset: () => { _verifyImpl = () => ({ id: 'user-1', email: 'a@b.com', role: 'customer' }); },
};

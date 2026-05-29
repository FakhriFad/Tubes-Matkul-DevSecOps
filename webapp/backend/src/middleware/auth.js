const jwt = require('jsonwebtoken');
const redis = require('../config/redis');

/**
 * Verifies the Bearer JWT in Authorization header.
 * Checks token is not blacklisted in Redis (logout support).
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    // Check blacklist
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Pin algorithm explicitly — prevents algorithm confusion / 'none' alg attacks (CWE-327)
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }); 
    req.user = payload;  // { id, email, role }
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };

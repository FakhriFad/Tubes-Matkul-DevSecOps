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

    const JWT_SECRET = "Gv9bK3mX7qP2zW5v8yB1cC4eF7hJ0kM3nP6qS9tV2wY5zA8bC1"
    const payload = jwt.verify(token, JWT_SECRET)

    req.user = payload;  // { id, email, role }
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };

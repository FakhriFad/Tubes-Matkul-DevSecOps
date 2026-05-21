'use strict';
/**
 * Brute-force / account lockout middleware.
 *
 * Tracks failed login attempts per email AND per IP in Redis.
 * After MAX_ATTEMPTS failures within WINDOW_SECS the account/IP is locked
 * for LOCKOUT_SECS. Every successful login resets the counter.
 *
 * Usage (in auth route):
 *   const { loginLimiter, recordFailure, recordSuccess } = require('../middleware/bruteforce');
 *   router.post('/login', loginLimiter, async (req, res) => { ... });
 */

const redis  = require('../config/redis');
const logger = require('../config/logger');

const MAX_ATTEMPTS   = parseInt(process.env.BRUTE_MAX_ATTEMPTS  || '5');
const WINDOW_SECS    = parseInt(process.env.BRUTE_WINDOW_SECS   || '900');  // 15 min
const LOCKOUT_SECS   = parseInt(process.env.BRUTE_LOCKOUT_SECS  || '900');  // 15 min

// ── Key helpers ───────────────────────────────────────────────────────────────
const emailKey = (email) => `brute:email:${email.toLowerCase()}`;
const ipKey    = (ip)    => `brute:ip:${ip}`;

// ── Express middleware ─────────────────────────────────────────────────────────
async function loginLimiter(req, res, next) {
  const email = req.body?.email?.toLowerCase?.() || '';
  const ip    = req.ip || 'unknown';

  try {
    const [emailCount, ipCount] = await Promise.all([
      email ? redis.get(emailKey(email)) : null,
      redis.get(ipKey(ip)),
    ]);

    const emailLocked = email && parseInt(emailCount || '0') >= MAX_ATTEMPTS;
    const ipLocked    = parseInt(ipCount || '0') >= MAX_ATTEMPTS * 3; // IP threshold is higher

    if (emailLocked) {
      logger.warn('Account locked due to brute force', { email, ip });
      return res.status(429).json({
        error: `Account temporarily locked after ${MAX_ATTEMPTS} failed attempts. Try again in 15 minutes.`,
        locked_until: new Date(Date.now() + LOCKOUT_SECS * 1000).toISOString(),
      });
    }

    if (ipLocked) {
      logger.warn('IP locked due to brute force', { ip });
      return res.status(429).json({
        error: `Too many login attempts from this IP address. Try again in 15 minutes.`,
        locked_until: new Date(Date.now() + LOCKOUT_SECS * 1000).toISOString(),
      });
    }

    next();
  } catch (err) {
    logger.error('loginLimiter error', { message: err.message });
    next(); // fail open — don't block legitimate users on Redis error
  }
}

// ── Called from route handler on failed login ─────────────────────────────────
async function recordFailure(email, ip) {
  try {
    const eKey = emailKey(email);
    const iKey = ipKey(ip);

    const [emailCount] = await Promise.all([
      redis.incr(eKey),
      redis.incr(iKey),
    ]);

    // Set/refresh TTL on every increment
    await Promise.all([
      redis.expire(eKey, LOCKOUT_SECS),
      redis.expire(iKey, LOCKOUT_SECS),
    ]);

    const remaining = MAX_ATTEMPTS - parseInt(emailCount);
    logger.warn('Failed login attempt', { email, ip, attempts: emailCount, remaining: Math.max(0, remaining) });
    return { attempts: parseInt(emailCount), remaining: Math.max(0, remaining) };
  } catch (err) {
    logger.error('recordFailure error', { message: err.message });
    return { attempts: 0, remaining: MAX_ATTEMPTS };
  }
}

// ── Called from route handler on successful login ─────────────────────────────
async function recordSuccess(email, ip) {
  try {
    await Promise.all([
      redis.del(emailKey(email)),
      redis.del(ipKey(ip)),
    ]);
  } catch (err) {
    logger.error('recordSuccess error', { message: err.message });
  }
}

// ── Returns remaining attempts info for a given email ─────────────────────────
async function getLockStatus(email, ip) {
  try {
    const [emailCount, ipCount] = await Promise.all([
      redis.get(emailKey(email)),
      redis.get(ipKey(ip)),
    ]);
    const eCount = parseInt(emailCount || '0');
    const iCount = parseInt(ipCount    || '0');
    return {
      email_attempts:    eCount,
      ip_attempts:       iCount,
      email_locked:      eCount >= MAX_ATTEMPTS,
      ip_locked:         iCount >= MAX_ATTEMPTS * 3,
      remaining_attempts: Math.max(0, MAX_ATTEMPTS - eCount),
    };
  } catch {
    return { email_attempts: 0, ip_attempts: 0, email_locked: false, ip_locked: false };
  }
}

module.exports = { loginLimiter, recordFailure, recordSuccess, getLockStatus };

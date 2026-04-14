const logger = require('../config/logger');
const express  = require('express');
const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const { authenticator } = require('otplib');
const { body, validationResult } = require('express-validator');

const db     = require('../config/db');
const redis  = require('../config/redis');
const { authenticate }  = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/auditLog');

const router = express.Router();

const SALT_ROUNDS = 12;
const JWT_EXPIRES = '8h';

// ── helpers ──────────────────────────────────────────────────────────────────
function issueToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function validationErrors(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(422).json({ errors: errors.array() });
    return true;
  }
  return false;
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password')
      .isLength({ min: 8 })
      .matches(/[A-Z]/).withMessage('Must contain uppercase')
      .matches(/[0-9]/).withMessage('Must contain a number'),
    body('full_name').trim().notEmpty(),
  ],
  async (req, res) => {
    if (validationErrors(req, res)) return;

    const { email, password, full_name } = req.body;

    try {
      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existing.rows.length) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      const result = await db.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, 'customer') RETURNING id, email, full_name, role`,
        [email, password_hash, full_name]
      );
      const user = result.rows[0];

      await writeAuditLog({ userId: user.id, action: 'REGISTER', entity: 'users', entityId: user.id, req });

      return res.status(201).json({ message: 'Registration successful', user });
    } catch (err) {
      logger.error('Register error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    if (validationErrors(req, res)) return;

    const { email, password } = req.body;

    try {
      const result = await db.query(
        'SELECT id, email, password_hash, full_name, role, mfa_enabled, mfa_secret, is_active FROM users WHERE email = $1',
        [email]
      );
      const user = result.rows[0];

      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) {
        await writeAuditLog({ userId: user.id, action: 'LOGIN_FAILED', entity: 'users', entityId: user.id, req, metadata: { reason: 'bad_password' } });
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // MFA check
      if (user.mfa_enabled) {
        const { totp } = req.body;
        if (!totp) {
          return res.status(200).json({ mfa_required: true, message: 'Provide TOTP code' });
        }
        const valid = authenticator.verify({ token: totp, secret: user.mfa_secret });
        if (!valid) {
          await writeAuditLog({ userId: user.id, action: 'LOGIN_MFA_FAILED', entity: 'users', entityId: user.id, req });
          return res.status(401).json({ error: 'Invalid MFA code' });
        }
      }

      const token = issueToken(user);
      await writeAuditLog({ userId: user.id, action: 'LOGIN', entity: 'users', entityId: user.id, req });

      return res.json({
        token,
        user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, mfa_enabled: user.mfa_enabled },
      });
    } catch (err) {
      logger.error('Login error', { message: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── POST /api/auth/mfa/setup ──────────────────────────────────────────────────
// Returns a TOTP secret + QR code. User must verify before MFA is activated.
router.post('/mfa/setup', authenticate, async (req, res) => {
  try {
    const secret  = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.user.email, 'EcomShop', secret);

    // Store temporarily in Redis (10 min) pending verification
    await redis.setex(`mfa_pending:${req.user.id}`, 600, secret);

    // Return the otpauth URI – the frontend renders the QR code itself
    return res.json({ secret, otpauth });
  } catch (err) {
    logger.error('MFA setup error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/mfa/verify ─────────────────────────────────────────────────
// Verifies TOTP and activates MFA for the account.
router.post('/mfa/verify', authenticate, [body('totp').notEmpty()], async (req, res) => {
  if (validationErrors(req, res)) return;

  const { totp } = req.body;
  try {
    const secret = await redis.get(`mfa_pending:${req.user.id}`);
    if (!secret) {
      return res.status(400).json({ error: 'No pending MFA setup. Call /mfa/setup first.' });
    }

    const valid = authenticator.verify({ token: totp, secret });
    if (!valid) {
      return res.status(400).json({ error: 'Invalid TOTP code' });
    }

    await db.query('UPDATE users SET mfa_secret = $1, mfa_enabled = TRUE WHERE id = $2', [secret, req.user.id]);
    await redis.del(`mfa_pending:${req.user.id}`);
    await writeAuditLog({ userId: req.user.id, action: 'MFA_ENABLED', entity: 'users', entityId: req.user.id, req });

    return res.json({ message: 'MFA enabled successfully' });
  } catch (err) {
    logger.error('MFA verify error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/mfa/disable ────────────────────────────────────────────────
router.post('/mfa/disable', authenticate, [body('totp').notEmpty()], async (req, res) => {
  if (validationErrors(req, res)) return;

  const { totp } = req.body;
  try {
    const result = await db.query('SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];

    if (!user?.mfa_enabled) {
      return res.status(400).json({ error: 'MFA is not enabled' });
    }

    const valid = authenticator.verify({ token: totp, secret: user.mfa_secret });
    if (!valid) {
      return res.status(400).json({ error: 'Invalid TOTP code' });
    }

    await db.query('UPDATE users SET mfa_secret = NULL, mfa_enabled = FALSE WHERE id = $1', [req.user.id]);
    await writeAuditLog({ userId: req.user.id, action: 'MFA_DISABLED', entity: 'users', entityId: req.user.id, req });

    return res.json({ message: 'MFA disabled' });
  } catch (err) {
    logger.error('MFA disable error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Blacklist current token until its natural expiry
    const decoded = jwt.decode(req.token);
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redis.setex(`blacklist:${req.token}`, ttl, '1');
    }
    await writeAuditLog({ userId: req.user.id, action: 'LOGOUT', entity: 'users', entityId: req.user.id, req });
    return res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error', { message: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, full_name, role, mfa_enabled, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;

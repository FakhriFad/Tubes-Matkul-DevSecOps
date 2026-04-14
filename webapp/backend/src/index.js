require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const fs         = require('fs');
const path       = require('path');

const db              = require('./config/db');
const logger          = require('./config/logger');
const { auditMiddleware } = require('./middleware/auditLog');

// Pipe morgan through winston
const morganStream = { write: (msg) => logger.http(msg.trim()) };

const authRoutes      = require('./routes/auth');
const itemRoutes      = require('./routes/items');
const cartRoutes      = require('./routes/cart');
const auditLogRoutes  = require('./routes/auditLogs');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security headers ──────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet());

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      process.env.CORS_ORIGIN || 'https://localhost',
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false }));

// ── Request logging ───────────────────────────────────────────────────────────
app.use(morgan('combined', { stream: morganStream }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stricter limit on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later.' },
});
app.use('/api/auth/', authLimiter);

// ── Audit logging middleware ───────────────────────────────────────────────────
app.use(auditMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/items',       itemRoutes);
app.use('/api/cart',        cartRoutes);
app.use('/api/audit-logs',  auditLogRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', message: 'Database unreachable' });
  }
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ── Database init then start ──────────────────────────────────────────────────
async function initDB() {
  const schema = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8');
  await db.query(schema);
  logger.info('Database schema applied');
}

initDB()
  .then(() => {
    app.listen(PORT, () => logger.info(`Backend running on port ${PORT}`));
  })
  .catch((err) => {
    logger.error('Failed to initialize DB', { message: err.message });
    process.exit(1);
  });

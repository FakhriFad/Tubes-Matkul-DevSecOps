'use strict';
/**
 * Prometheus metrics for the Express backend.
 * Exposes standard HTTP metrics + custom business metrics.
 * Endpoint: GET /metrics  (scraped by Prometheus)
 */

const client = require('prom-client');

// ── Default metrics (CPU, memory, event loop, GC) ────────────────────────────
const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'ecomshop_' });

// ── Custom HTTP metrics ───────────────────────────────────────────────────────
const httpRequestDuration = new client.Histogram({
  name: 'ecomshop_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'ecomshop_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestsInFlight = new client.Gauge({
  name: 'ecomshop_http_requests_in_flight',
  help: 'Number of HTTP requests currently being processed',
  registers: [register],
});

// ── Business metrics ──────────────────────────────────────────────────────────
const userRegistrations = new client.Counter({
  name: 'ecomshop_user_registrations_total',
  help: 'Total number of user registrations',
  registers: [register],
});

const loginAttempts = new client.Counter({
  name: 'ecomshop_login_attempts_total',
  help: 'Total login attempts',
  labelNames: ['result'],   // success | failure | mfa_failure
  registers: [register],
});

const cartCheckouts = new client.Counter({
  name: 'ecomshop_cart_checkouts_total',
  help: 'Total cart checkouts',
  labelNames: ['result'],   // success | failure
  registers: [register],
});

const activeCartItems = new client.Gauge({
  name: 'ecomshop_active_cart_items',
  help: 'Current number of items across all active carts (approximation)',
  registers: [register],
});

const cacheHits = new client.Counter({
  name: 'ecomshop_cache_hits_total',
  help: 'Redis cache hits',
  labelNames: ['cache'],    // items_list | item_single
  registers: [register],
});

const cacheMisses = new client.Counter({
  name: 'ecomshop_cache_misses_total',
  help: 'Redis cache misses',
  labelNames: ['cache'],
  registers: [register],
});

// ── Express middleware ────────────────────────────────────────────────────────
function metricsMiddleware(req, res, next) {
  // Skip the /metrics endpoint itself
  if (req.path === '/metrics') return next();

  const start = Date.now();
  httpRequestsInFlight.inc();

  res.on('finish', () => {
    httpRequestsInFlight.dec();

    // Normalise route: replace UUIDs with :id
    const route = req.route
      ? req.baseUrl + req.route.path
      : req.path.replace(/[0-9a-f-]{8,}/gi, ':id');

    const labels = {
      method:      req.method,
      route:       route || 'unknown',
      status_code: res.statusCode,
    };

    const duration = (Date.now() - start) / 1000;
    httpRequestDuration.observe(labels, duration);
    httpRequestTotal.inc(labels);
  });

  next();
}

// ── /metrics route handler ────────────────────────────────────────────────────
async function metricsHandler(_req, res) {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
}

module.exports = {
  metricsMiddleware,
  metricsHandler,
  // Export counters so route handlers can increment them
  metrics: {
    userRegistrations,
    loginAttempts,
    cartCheckouts,
    activeCartItems,
    cacheHits,
    cacheMisses,
  },
};

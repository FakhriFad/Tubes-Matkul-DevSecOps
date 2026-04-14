const db     = require('../config/db');
const logger = require('../config/logger');

/**
 * writeAuditLog – persist an audit entry.
 * Call directly from route handlers for granular control.
 */
async function writeAuditLog({ userId, action, entity, entityId, req, metadata = {} }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId   || null,
        action,
        entity   || null,
        entityId || null,
        req?.ip  || null,
        req?.headers?.['user-agent'] || null,
        JSON.stringify(metadata),
      ]
    );
  } catch (err) {
    // Audit failures must NOT crash the main request
    logger.error('Audit log write failed', { message: err.message });
  }
}

/**
 * Express middleware that auto-logs every mutating request
 * after response is sent (non-blocking).
 */
function auditMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    // Only log on successful mutations
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400) {
      const action = `${req.method}:${req.path}`.replace(/\/[0-9a-f-]{36}/gi, '/:id').toUpperCase();
      writeAuditLog({
        userId:   req.user?.id,
        action,
        entity:   req.path.split('/')[2] || null,
        entityId: req.params?.id || null,
        req,
        metadata: { statusCode: res.statusCode },
      }).catch(() => {});
    }
    return originalJson(body);
  };

  next();
}

module.exports = { writeAuditLog, auditMiddleware };

/**
 * RBAC middleware factory.
 * Usage: router.delete('/item/:id', authenticate, requireRole('admin'), handler)
 *
 * Roles hierarchy:  admin > customer
 */
const ROLE_HIERARCHY = { admin: 2, customer: 1 };

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userRank  = ROLE_HIERARCHY[req.user.role] ?? 0;
    const hasAccess = allowedRoles.some(
      (r) => ROLE_HIERARCHY[r] !== undefined && userRank >= ROLE_HIERARCHY[r]
    );

    if (!hasAccess) {
      return res.status(403).json({
        error: `Access denied. Required role: ${allowedRoles.join(' or ')}`,
      });
    }
    next();
  };
}

module.exports = { requireRole };

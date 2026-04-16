const jwt = require('jsonwebtoken');
const { env } = require('../config/env');

const checkAuth = (roles = []) => {
  return async (req, res, next) => {

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token required' });
    }

    const token = authHeader.split(' ')[1];

    try {
      const decoded = jwt.verify(token, env.jwtSecret);
      req.user = decoded;

      // PROACTIVE STATUS CHECK
      // Only applicable for users (vendors/customers). 
      // Admins are in a separate 'admins' table and shouldn't be checked against 'users'.
      if (decoded.role !== 'admin') {
        const db = require('../config/db');
        const [userRows] = await db.execute('SELECT status FROM users WHERE id = ?', [decoded.id]);
        
        if (userRows.length === 0 || userRows[0].status === 'inactive') {
          return res.status(403).json({ error: 'Account suspended. Please contact support.' });
        }
      }


      // Check for role permission
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
      }

      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expired' });
      }
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

  };
};

module.exports = checkAuth;

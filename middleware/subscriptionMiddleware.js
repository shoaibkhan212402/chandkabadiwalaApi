const db = require('../config/db');

/**
 * Middleware to check if a vendor has an active subscription.
 * Should be used after authMiddleware.
 */
module.exports = async (req, res, next) => {
  if (req.user && req.user.role === 'vendor') {
    try {
      const [rows] = await db.query('SELECT subscription_expires_at FROM users WHERE id = ?', [req.user.id]);
      const user = rows[0];

      if (!user || !user.subscription_expires_at) {
        return res.status(403).json({ 
          error: 'Subscription required', 
          subscriptionExpired: true,
          message: 'Please activate your subscription to continue.' 
        });
      }

      const expiryDate = new Date(user.subscription_expires_at);
      const now = new Date();

      if (expiryDate < now) {
        return res.status(403).json({ 
          error: 'Subscription expired', 
          subscriptionExpired: true,
          expiryDate: user.subscription_expires_at,
          message: 'Your subscription has expired. Please renew to accept orders.' 
        });
      }
    } catch (err) {
      console.error('Subscription check failed:', err);
      // Fail open or closed? Closed is safer for business.
      return res.status(500).json({ error: 'Failed to verify subscription status' });
    }
  }
  
  next();
};

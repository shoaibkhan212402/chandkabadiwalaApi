const db = require('../config/db');

// Helper: save a notification to DB + optionally push
exports.createNotification = async (userId, title, message, type = 'general', payload = null) => {
  try {
    const payloadStr = payload ? JSON.stringify(payload) : null;
    await db.execute(
      'INSERT INTO notifications (user_id, title, message, type, payload) VALUES (?, ?, ?, ?, ?)',
      [userId, title, message, type, payloadStr]
    );
  } catch (err) {
    console.error('createNotification error:', err.message);
  }
};

// GET /api/notifications — get logged-in user's notifications
exports.getNotifications = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    const unreadCount = rows.filter(r => !r.is_read).length;
    res.json({ notifications: rows, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/notifications/:id/read
exports.markRead = async (req, res) => {
  try {
    await db.execute(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PATCH /api/notifications/read-all
exports.markAllRead = async (req, res) => {
  try {
    await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

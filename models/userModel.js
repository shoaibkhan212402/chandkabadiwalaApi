const db = require('../config/db');

class User {
  static async findByPhone(phone) {
    const [rows] = await db.execute('SELECT * FROM users WHERE phone = ?', [phone]);
    return rows[0];
  }

  static async findById(id) {
    const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
    return rows[0];
  }

  static async create(phone, role = 'customer', status = 'active') {
    // Vendors: subscription stays OFF until admin approves.
    // Trial clock starts on approval, not registration.
    const subActive = 0;

    const [result] = await db.execute(
      'INSERT INTO users (phone, role, status, subscription_active, subscription_expires_at) VALUES (?, ?, ?, ?, ?)',
      [phone, role, status, subActive, null]
    );
    return { 
      id: result.insertId, 
      phone, 
      role, 
      status, 
      subscription_active: subActive,
      subscription_expires_at: null
    };
  }

  static async updateStatus(id, status) {
    await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, id]);
  }

  static async findAll() {
    const [rows] = await db.execute('SELECT id, phone, role, status, created_at FROM users ORDER BY created_at DESC');
    return rows;
  }
}

module.exports = User;

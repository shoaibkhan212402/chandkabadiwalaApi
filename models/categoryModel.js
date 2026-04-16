const db = require('../config/db');

class Category {
  static async findAll() {
    const [rows] = await db.query('SELECT * FROM categories');
    return rows;
  }

  static async create(name, icon, description) {
    const [result] = await db.execute(
      'INSERT INTO categories (name, icon, description) VALUES (?, ?, ?)',
      [name, icon, description]
    );
    return result.insertId;
  }

  static async update(id, name, icon, description) {
    const [result] = await db.execute(
      'UPDATE categories SET name = ?, icon = ?, description = ? WHERE id = ?',
      [name, icon, description, id]
    );
    return result.affectedRows;
  }

  static async search(query) {
    const [rows] = await db.query('SELECT * FROM categories WHERE name LIKE ?', [`%${query}%`]);
    return rows;
  }

  static async delete(id) {
    const [result] = await db.execute('DELETE FROM categories WHERE id = ?', [id]);
    return result.affectedRows;
  }
}

module.exports = Category;

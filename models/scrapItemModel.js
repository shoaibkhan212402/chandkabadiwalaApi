const db = require('../config/db');

class ScrapItem {
  static async findByCategoryId(categoryId) {
    const [rows] = await db.query('SELECT * FROM scrap_items WHERE category_id = ?', [categoryId]);
    return rows;
  }

  static async findAllWithCategory() {
    const [rows] = await db.query(`
      SELECT si.*, cat.name as category_name, cat.icon as category_icon 
      FROM scrap_items si
      JOIN categories cat ON si.category_id = cat.id
    `);
    return rows;
  }

  static async create(categoryId, name, rate, unit, image = null) {
    const [result] = await db.execute(
      'INSERT INTO scrap_items (category_id, name, rate, unit, image) VALUES (?, ?, ?, ?, ?)',
      [categoryId, name, rate, unit, image]
    );
    return result.insertId;
  }

  static async update(id, categoryId, name, rate, unit, image = null) {
    const [result] = await db.execute(
      'UPDATE scrap_items SET category_id = ?, name = ?, rate = ?, unit = ?, image = ? WHERE id = ?',
      [categoryId, name, rate, unit, image, id]
    );
    return result.affectedRows;
  }

  static async search(query) {
    const [rows] = await db.query('SELECT * FROM scrap_items WHERE name LIKE ?', [`%${query}%`]);
    return rows;
  }

  static async updateRate(id, rate) {
    const [result] = await db.execute('UPDATE scrap_items SET rate = ? WHERE id = ?', [rate, id]);
    return result.affectedRows;
  }

  static async delete(id) {
    const [result] = await db.execute('DELETE FROM scrap_items WHERE id = ?', [id]);
    return result.affectedRows;
  }
}

module.exports = ScrapItem;

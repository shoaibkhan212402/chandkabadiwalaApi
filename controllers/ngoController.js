const db = require('../config/db');

exports.getAllNGOs = async (req, res) => {
  try {
    // Return all NGOs (including inactive) so admin can manage them all
    const [rows] = await db.query('SELECT * FROM ngos ORDER BY is_active DESC, name ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getNGOById = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM ngos WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'NGO not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Admin: CRUD
exports.createNGO = async (req, res) => {
  const { name, logo, address, phone, description, upi_id, bank_account, ifsc_code } = req.body;
  try {
    const [result] = await db.execute(
      'INSERT INTO ngos (name, logo, address, phone, description, upi_id, bank_account, ifsc_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, logo || null, address || null, phone || null, description || null, upi_id || null, bank_account || null, ifsc_code || null]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateNGO = async (req, res) => {
  const { name, logo, address, phone, description, is_active, upi_id, bank_account, ifsc_code } = req.body;
  try {
    await db.execute(
      'UPDATE ngos SET name = ?, logo = ?, address = ?, phone = ?, description = ?, is_active = ?, upi_id = ?, bank_account = ?, ifsc_code = ? WHERE id = ?',
      [name, logo || null, address || null, phone || null, description || null, is_active ?? 1, upi_id || null, bank_account || null, ifsc_code || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteNGO = async (req, res) => {
  try {
    // Permanent deletion of the NGO partner
    await db.execute('DELETE FROM ngos WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'NGO permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


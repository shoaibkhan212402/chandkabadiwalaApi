const db = require('../config/db');

class Vendor {
  static async create(userId, businessName, address) {
    const [result] = await db.execute(
      'INSERT INTO vendors (user_id, business_name, address) VALUES (?, ?, ?)',
      [userId, businessName, address]
    );
    return result.insertId;
  }

  static async upsertDetailed(data) {
    const {
      userId,
      businessName,
      fullName,
      address,
      lat,
      lng,
      aadhar_front,
      aadhar_back,
      pan_front,
      pan_back,
      shop_photo,
      upi_id,
      designation,
      pincode,
      service_range,
      bank_name,
      account_number,
      ifsc_code,
    } = data;
    
    // Default 35, Max 50
    const finalRange = Math.min(Math.max(service_range || 35, 1), 50);
    
    const [result] = await db.execute(
      `INSERT INTO vendors (user_id, business_name, full_name, address, lat, lng, aadhar_front, aadhar_back, pan_front, pan_back, shop_photo, upi_id, designation, pincode, service_range, bank_name, account_number, ifsc_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         business_name = COALESCE(?, business_name),
         full_name = COALESCE(?, full_name),
         address = COALESCE(?, address),
         lat = COALESCE(?, lat),
         lng = COALESCE(?, lng),
         aadhar_front = COALESCE(?, aadhar_front),
         aadhar_back = COALESCE(?, aadhar_back),
         pan_front = COALESCE(?, pan_front),
         pan_back = COALESCE(?, pan_back),
         shop_photo = COALESCE(?, shop_photo),
         upi_id = COALESCE(?, upi_id),
         designation = COALESCE(?, designation),
         pincode = COALESCE(?, pincode),
         service_range = COALESCE(?, service_range),
         bank_name = COALESCE(?, bank_name),
         account_number = COALESCE(?, account_number),
         ifsc_code = COALESCE(?, ifsc_code)`,
      [
        userId, 
        businessName || null, fullName || null, address || null, lat || null, lng || null, 
        aadhar_front || null, aadhar_back || null, pan_front || null, pan_back || null, shop_photo || null,
        upi_id || null, designation || null, pincode || null, finalRange, bank_name || null, account_number || null, ifsc_code || null,
        businessName || null, fullName || null, address || null, lat || null, lng || null, 
        aadhar_front || null, aadhar_back || null, pan_front || null, pan_back || null, shop_photo || null,
        upi_id || null, designation || null, pincode || null, finalRange, bank_name || null, account_number || null, ifsc_code || null
      ]
    );
    return result;
  }

  static async findPending() {
    const [rows] = await db.query(`
      SELECT u.id as user_id, u.phone, u.status, v.business_name, v.address 
      FROM users u
      JOIN vendors v ON u.id = v.user_id
      WHERE u.status = 'pending' AND u.role = 'vendor'
    `);
    return rows;
  }

  static async findById(userId) {
    const [rows] = await db.query(`
       SELECT u.*, v.business_name, v.address, v.service_range 
       FROM users u
       JOIN vendors v ON u.id = v.user_id
       WHERE u.id = ?
     `, [userId]);
    return rows[0];
  }
}

module.exports = Vendor;

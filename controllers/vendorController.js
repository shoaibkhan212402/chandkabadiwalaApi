const db = require('../config/db');

// Business Center Data
exports.getBusinessPreview = async (req, res) => {
  try {
    const vendor_id = req.user.id;
    
    // Get vendor details for Shop Certificate
    const [vendors] = await db.execute(
      'SELECT v.*, u.phone FROM vendors v JOIN users u ON v.user_id = u.id WHERE v.user_id = ?',
      [vendor_id]
    );

    if (vendors.length === 0) {
      return res.status(404).json({ error: 'Vendor profile not found' });
    }

    const vendor = vendors[0];

    res.json({
      vendor,
      certificateId: `CKW-CERT-${vendor_id}-${new Date().getFullYear()}`,
      validUntil: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
      issuedDate: new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      })
    });
  } catch (err) {
    console.error('Get Business Preview Error:', err);
    res.status(500).json({ error: 'Failed to fetch business data' });
  }
};
// Process Customer Donation
exports.processDonation = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { vendor_id, amount, donor_name, customer_id, message } = req.body;
    const cert_id = `CKW-DON-${Date.now()}-${vendor_id}`;

    // 1. Record Donation
    await connection.execute(
      'INSERT INTO donations (customer_id, vendor_id, amount, certificate_id, donor_name, message) VALUES (?, ?, ?, ?, ?, ?)',
      [customer_id, vendor_id, amount, cert_id, donor_name, message]
    );

    // 2. Update Vendor's Admin Due in Wallet
    // Ensure wallet exists
    const [wallets] = await connection.execute('SELECT * FROM wallets WHERE user_id = ?', [vendor_id]);
    if (wallets.length === 0) {
      await connection.execute('INSERT INTO wallets (user_id, balance, admin_due) VALUES (?, 0, ?)', [vendor_id, amount]);
    } else {
      await connection.execute('UPDATE wallets SET admin_due = admin_due + ? WHERE user_id = ?', [amount, vendor_id]);
    }

    // 3. Log transaction for tracking
    const [updatedWallet] = await connection.execute('SELECT id FROM wallets WHERE user_id = ?', [vendor_id]);
    await connection.execute(
      'INSERT INTO transactions (wallet_id, type, entity, amount, description) VALUES (?, "credit", "donation", ?, ?)',
      [updatedWallet[0].id, amount, `Customer Donation by ${donor_name}`]
    );

    await connection.commit();

    res.json({
      success: true,
      message: 'Donation processed successfully',
      certificate: {
        certificate_id: cert_id,
        donor_name,
        amount,
        date: new Date().toLocaleDateString('en-GB')
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('Process Donation Error:', err);
    res.status(500).json({ error: 'Failed to process donation' });
  } finally {
    connection.release();
  }
};

// Get Vendor Payment/Wallet Details
exports.getVendorWallet = async (req, res) => {
  try {
    const vendor_id = req.user.id;
    
    const [wallets] = await db.execute('SELECT * FROM wallets WHERE user_id = ?', [vendor_id]);
    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE wallet_id = (SELECT id FROM wallets WHERE user_id = ?) ORDER BY created_at DESC LIMIT 10', 
      [vendor_id]
    );

    res.json({
      wallet: wallets[0] || { balance: 0, admin_due: 0 },
      transactions
    });
  } catch (err) {
    console.error('Get Wallet Error:', err);
    res.status(500).json({ error: 'Failed to fetch wallet data' });
  }
};
// Check Vendor Availability for User
exports.checkAvailability = async (req, res) => {
  const { lat, lng, pincode } = req.body;
  
  if (!pincode && (!lat || !lng)) {
    return res.status(400).json({ error: 'Location coordinates or pincode required' });
  }

  try {
    // 1. Check by Pincode first (Fast)
    if (pincode) {
      const [pinRows] = await db.execute(
        'SELECT v.user_id FROM vendors v JOIN users u ON v.user_id = u.id WHERE v.pincode = ? AND u.status = "active"',
        [pincode]
      );
      if (pinRows.length > 0) {
        return res.json({ available: true, message: 'Vendors available in your area!' });
      }
    }

    // 2. Check by Distance (20km radius)
    if (lat && lng) {
      const [vendors] = await db.execute(
        `SELECT v.user_id, v.lat, v.lng, v.service_range,
        (6371 * acos(cos(radians(?)) * cos(radians(v.lat)) * cos(radians(v.lng) - radians(?)) + sin(radians(?)) * sin(radians(v.lat)))) AS distance
        FROM vendors v
        JOIN users u ON v.user_id = u.id
        WHERE u.status = "active"
        HAVING distance <= LEAST(v.service_range, 20)
        ORDER BY distance ASC`,
        [lat, lng, lat]
      );

      if (vendors.length > 0) {
        return res.json({ available: true, message: 'Vendors available nearby!' });
      }
    }

    res.json({ available: false, message: 'We are currently unable to proceed in your location. No vendors nearby.' });
  } catch (err) {
    console.error('Check Availability Error:', err);
    res.status(500).json({ error: 'Failed to check availability' });
  }
};

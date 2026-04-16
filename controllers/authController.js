const User = require('../models/userModel');
const Vendor = require('../models/vendorModel');
const jwt = require('jsonwebtoken');
const redisClient = require('../config/redis');
const whatsappService = require('../utils/whatsappService');
const { env } = require('../config/env');

// Redis keys for OTP
const OTP_PREFIX = 'otp:';

exports.sendOTP = async (req, res) => {
  const { phone, role, isRegistering } = req.body;
  if (!phone) return res.status(400).json({ error: 'Phone is required' });

  // If logging in as vendor (not registering), check if vendor exists
  if (role === 'vendor' && !isRegistering) {
    const db = require('../config/db');
    const [rows] = await db.query('SELECT * FROM users WHERE phone = ? AND role = ?', [phone, 'vendor']);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No user found, please register' });
    }
  }

  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  try {
    // Attempt WhatsApp Send FIRST
    try {
      const waRes = await whatsappService.sendOTP(phone, otp);
      if (!waRes.success) {
        return res.status(500).json({ error: 'Failed to send WhatsApp OTP. Please ensure WhatsApp server is active.' });
      }
    } catch (wsErr) {
      console.error('⚠️ WhatsApp service error:', wsErr.message);
      return res.status(500).json({ error: 'WhatsApp service is not available right now.' });
    }

    // Store OTP in Redis with 10 min (600s) expiration after successfully sending
    await redisClient.set(`${OTP_PREFIX}${phone}`, otp, { EX: 600 });

    // Mask phone for logs in production to prevent log scraping
    if (env.nodeEnv !== 'production') {
      console.log(`📲 OTP dispatched via WhatsApp to: ${phone}`);
    }

    res.json({ message: 'OTP sent successfully!' });
  } catch (err) {
    res.status(500).json({ error: 'Redis cache failed' });
  }
};

exports.verifyOTP = async (req, res) => {
  const { phone, otp } = req.body;

  try {
    const cachedOtp = await redisClient.get(`${OTP_PREFIX}${phone}`);

    if (!cachedOtp || otp !== cachedOtp) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    let user = await User.findByPhone(phone);

    // Role-based behavior logic
    const requestedRole = req.body.role || 'customer';

    if (!user) {
      if (requestedRole === 'vendor') {
        return res.status(404).json({
          error: 'Vendor not found. Please register.',
          needsRegistration: true
        });
      }
      // Create new customer by default
      user = await User.create(phone, 'customer', 'active');
    } else {
      // User exists - check if they are trying to switch roles
      if (requestedRole === 'vendor' && user.role !== 'vendor') {
        // Existing customer wants to become a vendor
        return res.status(404).json({
          error: 'You are registered as a customer. Complete vendor profile to partner with us!',
          needsRegistration: true
        });
      }
    }

    // We allow pending vendors to login, but the frontend AppNavigator will 
    // strictly trap them in the VendorStatus screen until they are approved.

    if (user.status === 'inactive') {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact support.' });
    }

    // JWT Auth
    const token = jwt.sign({ id: user.id, role: user.role }, env.jwtSecret, { expiresIn: '7d' });

    await redisClient.del(`${OTP_PREFIX}${phone}`); // cleanup
    res.json({ token, user, message: `Welcome ${user.role}!` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.registerVendor = async (req, res) => {
  const {
    phone,
    businessName,
    fullName,
    full_name,
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
  } = req.body;

  try {
    const db = require('../config/db');
    let userData = await User.findByPhone(phone);

    let isNewlyVendor = false;
    if (userData) {
      if (userData.role !== 'vendor') {
        await db.execute('UPDATE users SET role = "vendor", status = "pending" WHERE id = ?', [userData.id]);
        userData.role = 'vendor';
        userData.status = 'pending';
        isNewlyVendor = true;
      }
    } else {
      userData = await User.create(phone, 'vendor', 'pending');
      isNewlyVendor = true;
    }

    const userId = userData.id || userData.insertId;

    if (isNewlyVendor) {
      const trialExpiry = new Date();
      trialExpiry.setDate(trialExpiry.getDate() + 90); // 3 months trial
      await db.execute('UPDATE users SET subscription_expires_at = ? WHERE id = ?', [trialExpiry, userId]);
    }

    // Upsert Vendor Profile with all documents
    await Vendor.upsertDetailed({
      userId,
      businessName,
      fullName: fullName || full_name,
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
    });

    const token = jwt.sign({ id: userId, role: 'vendor' }, env.jwtSecret, { expiresIn: '7d' });

    res.status(200).json({
      message: 'Registration successful!',
      token,
      user: { ...userData, id: userId }
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
};

exports.adminLogin = async (req, res) => {
  const email = req.body.email?.trim();
  const password = req.body.password;

  try {
    const db = require('../config/db');
    const bcrypt = require('bcryptjs');

    // Fetch the admin from the database
    const [rows] = await db.execute('SELECT * FROM admins WHERE email = ?', [email]);
    const admin = rows[0];

    if (!admin) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    // Verify bcrypt hash
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }



    // Generate JWT token
    const token = jwt.sign(
      { id: admin.id, role: admin.role, email: admin.email },
      env.jwtSecret,
      { expiresIn: '1d' }
    );

    return res.json({
      token,
      message: 'Admin login successful',
      user: { id: admin.id, email: admin.email, role: admin.role, name: admin.name }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({ error: 'Internal server error during authentication' });
  }
};

exports.updatePushToken = async (req, res) => {
  const { pushToken } = req.body;
  if (!req.user || !pushToken) return res.status(400).json({ error: 'Missing token or user' });

  try {
    const db = require('../config/db');
    await db.execute('UPDATE users SET push_token = ? WHERE id = ?', [pushToken, req.user.id]);
    res.json({ success: true, message: 'Push token updated' });
  } catch (err) {
    console.error('Push token update error:', err);
    res.status(500).json({ error: 'Failed to update push token' });
  }
};

exports.updateProfile = async (req, res) => {
  const {
    name,
    designation,
    profileImage,
    address, address_line1, address_area, address_city,
    address_state, address_pincode, address_lat, address_lng
  } = req.body;
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const db = require('../config/db');

    // 1. Update Core User table
    await db.execute(
      `UPDATE users SET
        name = COALESCE(?, name),
        address = COALESCE(?, address),
        address_line1 = COALESCE(?, address_line1),
        address_area = COALESCE(?, address_area),
        address_city = COALESCE(?, address_city),
        address_state = COALESCE(?, address_state),
        address_pincode = COALESCE(?, address_pincode),
        address_lat = COALESCE(?, address_lat),
        address_lng = COALESCE(?, address_lng)
      WHERE id = ?`,
      [
        name || null, address || null,
        address_line1 || null, address_area || null,
        address_city || null, address_state || null,
        address_pincode || null,
        address_lat || null, address_lng || null,
        userId
      ]
    );

    // 2. If Vendor, also update vendor-specific fields
    const [uRows] = await db.execute('SELECT role FROM users WHERE id = ?', [userId]);
    if (uRows.length > 0 && uRows[0].role === 'vendor') {
      const updates = [];
      const params = [];

      if (name) { updates.push('full_name = ?'); params.push(name); }
      if (designation) { updates.push('designation = ?'); params.push(designation); }
      if (profileImage) { updates.push('shop_photo = ?'); params.push(profileImage); }

      if (updates.length > 0) {
        params.push(userId);
        await db.execute(`UPDATE vendors SET ${updates.join(', ')} WHERE user_id = ?`, params);
      }
    }

    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('Update Profile Error:', err);
    res.status(500).json({ error: 'Failed to update profile information' });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const User = require('../models/userModel');
    const user = (req.user?.phone ? await User.findByPhone(req.user.phone) : await User.findById(req.user?.id));
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'vendor') {
      const db = require('../config/db');
      const [vendorRows] = await db.execute('SELECT * FROM vendors WHERE user_id = ?', [user.id]);
      if (vendorRows.length > 0) {
        user.vendorDetails = vendorRows[0];
        // Set primary name to owner full name
        if (vendorRows[0].full_name) {
          user.name = vendorRows[0].full_name;
        }
        user.status = vendorRows[0].status;
      }

      const [pickupRows] = await db.execute('SELECT COUNT(*) as pickCount, SUM(final_amount) as totalEarned FROM pickups WHERE vendor_id = ? AND status="completed"', [user.id]);
      user.stats = {
        pickCount: pickupRows[0].pickCount || 0,
        totalEarned: pickupRows[0].totalEarned || 0
      };

      const [reviewRows] = await db.execute('SELECT AVG(rating) as avgRating FROM reviews WHERE vendor_id = ?', [user.id]);
      user.stats.rating = reviewRows[0].avgRating ? parseFloat(reviewRows[0].avgRating).toFixed(1) : '5.0';

      const [allPickups] = await db.execute('SELECT COUNT(*) as totalAssigned FROM pickups WHERE vendor_id = ?', [user.id]);
      const assignedCount = allPickups[0].totalAssigned || 0;
      user.stats.completionRate = assignedCount > 0 ? ((user.stats.pickCount / assignedCount) * 100).toFixed(0) + '%' : '100%';
    } else {
      const db = require('../config/db');
      const [pickupRows] = await db.execute('SELECT COUNT(*) as pickCount FROM pickups WHERE user_id = ?', [user.id]);
      user.stats = pickupRows[0];
    }

    res.json(user);
  } catch (err) {
    console.error('getProfile Error:', err);
    res.status(500).json({ error: err.message });
  }
};


exports.deleteAccount = async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const db = require('../config/db');

    // 1. Wipe strictly confidential vendor documents and schema (Aadhar, PAN)
    await db.execute('DELETE FROM vendors WHERE user_id = ?', [req.user.id]);

    // 2. Anonymize or drop the user row per GDPR/AppStore policy
    await db.execute('DELETE FROM users WHERE id = ?', [req.user.id]);

    res.json({ success: true, message: 'Account and associated personal data permanently deleted.' });
  } catch (err) {
    console.error('Delete Account Error:', err);
    res.status(500).json({ error: 'Critical failure during account deletion process. Please contact support.' });
  }
};

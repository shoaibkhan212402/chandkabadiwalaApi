const db = require('../config/db');
const { Expo } = require('expo-server-sdk');
let expo = new Expo();

exports.getPendingVendors = async (req, res) => {
  try {
    const [vendors] = await db.query(`
      SELECT u.id as user_id, u.phone, u.status, v.business_name, v.full_name, v.designation, v.pincode, v.address, 
             v.aadhar_front, v.aadhar_back, v.pan_front, v.pan_back, v.shop_photo 
      FROM users u
      JOIN vendors v ON u.id = v.user_id
      WHERE u.status = 'pending' AND u.role = 'vendor'
    `);
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAllVendors = async (req, res) => {
  try {
    const [vendors] = await db.query(`
      SELECT u.id as user_id, u.phone, u.status, v.business_name, v.full_name, v.designation, v.pincode, v.address,
             v.aadhar_front, v.aadhar_back, v.pan_front, v.pan_back, v.shop_photo
      FROM users u
      JOIN vendors v ON u.id = v.user_id
      WHERE u.role = 'vendor'
      ORDER BY FIELD(u.status, 'pending', 'active', 'inactive')
    `);
    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.verifyVendor = async (req, res) => {
  const { userId, action } = req.body;
  
  if (!['active', 'inactive'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  try {
    if (action === 'active') {
      // ✅ Start the 90-day free trial from TODAY (approval date)
      const trialExpires = new Date();
      trialExpires.setDate(trialExpires.getDate() + 90);
      
      await db.execute(
        'UPDATE users SET status = ?, subscription_active = 1, subscription_expires_at = ? WHERE id = ?',
        [action, trialExpires, userId]
      );
    } else {
      // Rejected — clear subscription
      await db.execute(
        'UPDATE users SET status = ?, subscription_active = 0, subscription_expires_at = NULL WHERE id = ?',
        [action, userId]
      );
    }

    // Sync vendor table status
    await db.execute('UPDATE vendors SET status = ? WHERE user_id = ?', [action, userId]);
    
    // Get vendor info for notification
    const [vendorRows] = await db.query(
      `SELECT u.push_token, u.phone, v.business_name FROM users u 
       JOIN vendors v ON v.user_id = u.id WHERE u.id = ?`,
      [userId]
    );
    const vendor = vendorRows[0];
    
    if (vendor) {
      const { createNotification } = require('./notificationController');
      const pushService = require('../utils/pushService');
      const whatsapp = require('../utils/whatsappService');

      if (action === 'active') {
        await createNotification(
          userId,
          '🎉 Account Activated!',
          'Your partner account is verified! Log in now to start accepting scrap pickups. 90-day free trial started.',
          'account',
          null
        );
        if (vendor.push_token) {
          pushService.sendPushNotification(
            vendor.push_token,
            '🎉 Account Verified — Login Now!',
            'Your ChandKabadiWala partner account is active. Open the app to start accepting pickups!',
            { screen: 'Main' }
          );
        }
        try {
          await whatsapp.sendMessage(
            vendor.phone,
            `🎉 *Congratulations, ${vendor.business_name || 'Partner'}!*\n\nYour *ChandKabadiWala Partner Account* has been verified and activated!\n\n✅ You can now *login to the app* and start accepting scrap pickup orders in your area.\n\n🆓 Your *90-day FREE trial* has started today.\n\n🚛 Customers will pay you *cash directly* when you collect their scrap.\n\nWelcome to the team! 💪`
          );
        } catch (_) {}
      } else {
        await createNotification(
          userId,
          '❌ Account Not Approved',
          'Your partner account verification was unsuccessful. Please contact support for details.',
          'account',
          null
        );
        if (vendor.push_token) {
          pushService.sendPushNotification(
            vendor.push_token,
            '❌ Verification Unsuccessful',
            'Contact our support team for details about your partner application.',
            {}
          );
        }
        try {
          await whatsapp.sendMessage(
            vendor.phone,
            `❌ Dear ${vendor.business_name || 'Partner'},\n\nUnfortunately, your ChandKabadiWala partner account could *not be verified* at this time.\n\nPlease contact our support team for more information and to resolve any issues with your documents.`
          );
        } catch (_) {}
      }
    }

    res.json({ message: `Vendor account set to ${action}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteVendor = async (req, res) => {
  const { userId } = req.params;
  try {
    // Delete user (cascade will delete from vendors)
    await db.execute('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ message: 'Vendor record deleted successfully' });
  } catch (err) {
    console.error('Delete Vendor Error:', err);
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const [users] = await db.query("SELECT id, phone, role, status, created_at FROM users ORDER BY created_at DESC");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.toggleUserStatus = async (req, res) => {
  const { userId, status } = req.body;
  // 'inactive' maps to suspended — must match users table ENUM('active', 'pending', 'inactive')
  if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status. Use "active" or "inactive".' });

  try {
    // 1. Mark main user record as inactive/active
    await db.execute('UPDATE users SET status = ? WHERE id = ?', [status, userId]);

    // 2. Cascade to the vendor table safely
    await db.execute('UPDATE vendors SET status = ? WHERE user_id = ?', [status === 'inactive' ? 'inactive' : 'active', userId]);

    res.json({ message: `Successfully ${status === 'inactive' ? 'Suspended' : 'Reactivated'} User #${userId}` });
  } catch (err) {
    console.error('toggleUserStatus config error:', err);
    res.status(500).json({ error: 'System failure switching user state.' });
  }
};

exports.getStats = async (req, res) => {
  try {
    const [usersCount] = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'customer'");
    const [vendorsCount] = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'vendor' AND status = 'active'");
    const [pickupsCount] = await db.query("SELECT COUNT(*) as count FROM pickups");
    const [totalWeight] = await db.query("SELECT SUM(IFNULL(actual_weight, 0)) as total FROM pickup_items");
    const [subRevenue] = await db.query("SELECT SUM(amount) as total FROM transactions WHERE entity = 'subscription'");
    const [expiredCount] = await db.query("SELECT COUNT(*) as count FROM users WHERE role = 'vendor' AND status = 'active' AND subscription_expires_at < NOW()");
    const [dailyOrders] = await db.query("SELECT COUNT(*) as count FROM pickups WHERE DATE(created_at) = CURDATE()");
    
    res.json({
      customers: usersCount[0].count,
      vendors: vendorsCount[0].count,
      pickups: pickupsCount[0].count,
      weight: totalWeight[0].total || 0,
      revenue: subRevenue[0].total || 0,
      expiredCount: expiredCount[0].count,
      dailyOrders: dailyOrders[0].count
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    // Last 7 days revenue chart data
    const [revenueData] = await db.query(`
      SELECT DATE(created_at) as date, SUM(final_amount) as amount
      FROM pickups 
      WHERE status = 'completed' AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    // Category distribution
    const [categoryData] = await db.query(`
      SELECT c.name, COUNT(pi.id) as count
      FROM pickup_items pi
      JOIN scrap_items si ON pi.scrap_item_id = si.id
      JOIN categories c ON si.category_id = c.id
      GROUP BY c.id
    `);

    res.json({ revenueData, categoryData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getWhatsappStatus = (req, res) => {
  const whatsappService = require('../utils/whatsappService');
  res.json({
    isReady: whatsappService.isWhatsAppReady(),
    qrCodeUrl: whatsappService.getQrCode()
  });
};

exports.getAllPickups = async (req, res) => {
  try {
    const [pickups] = await db.query(`
      SELECT p.*, u.phone as customer_phone 
      FROM pickups p
      JOIN users u ON p.user_id = u.id
      ORDER BY p.created_at DESC
    `);
    res.json(pickups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getActivityLog = async (req, res) => {
  try {
    const [logs] = await db.query(`
      SELECT n.*, u.phone, u.role
      FROM notifications n
      JOIN users u ON n.user_id = u.id
      ORDER BY n.created_at DESC
      LIMIT 100
    `);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.logoutWhatsApp = async (req, res) => {
  const whatsappService = require('../utils/whatsappService');
  const result = await whatsappService.logoutWhatsApp();
  res.json(result);
};

exports.reconnectWhatsApp = async (req, res) => {
  const whatsappService = require('../utils/whatsappService');
  const result = await whatsappService.reconnectWhatsApp();
  res.json({ success: true, message: 'Reconnection attempt started' });
};

exports.resetWhatsApp = async (req, res) => {
  const whatsappService = require('../utils/whatsappService');
  const result = await whatsappService.resetWhatsAppSession();
  res.json(result);
};

exports.exportData = async (req, res) => {
  const { type } = req.params;
  try {
    let data = [];
    if (type === 'users') {
      [data] = await db.query('SELECT id, phone, role, status, created_at FROM users');
    } else if (type === 'pickups') {
      [data] = await db.query('SELECT id, user_id, vendor_id, type, status, total_bill, created_at FROM pickups');
    } else if (type === 'transactions') {
      [data] = await db.query('SELECT id, wallet_id, type, entity, amount, created_at FROM transactions');
    } else {
      return res.status(400).json({ error: 'Invalid export type' });
    }

    if (data.length === 0) {
      return res.status(404).json({ error: 'No data to export' });
    }

    // Convert to CSV
    const header = Object.keys(data[0]).join(',') + '\n';
    const rows = data.map(row => Object.values(row).map(val => `"${val}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_export.csv`);
    res.send(header + rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.broadcastNotification = async (req, res) => {
  const { title, body, targetRole } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });

  try {
    let query = 'SELECT push_token FROM users WHERE push_token IS NOT NULL AND push_token != "" AND status != "inactive"';
    let params = [];
    
    if (targetRole && targetRole !== 'all') {
      query += ' AND role = ?';
      params.push(targetRole);
    }

    const [rows] = await db.query(query, params);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No active users found with registered push tokens for this segment.' });
    }

    let messages = [];
    for (let user of rows) {
      if (!Expo.isExpoPushToken(user.push_token)) {
        continue; // Skip silently if corrupted tokens exist
      }

      messages.push({
        to: user.push_token,
        sound: 'default',
        title: title,
        body: body,
        data: { generatedBy: 'admin', time: Date.now() },
      });
    }

    if (messages.length === 0) {
      return res.status(400).json({ error: 'No valid Expo Push Tokens found amongst targeted users.' });
    }

    let chunks = expo.chunkPushNotifications(messages);
    let tickets = [];
    
    // Background execution
    (async () => {
      for (let chunk of chunks) {
        try {
          let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          console.error('Push Notification Chunk Error:', error);
        }
      }
    })();

    res.json({ success: true, message: `Notification successfully launched to ${messages.length} device(s)!` });
  } catch (err) {
    console.error('Notification Broadcast Error:', err);
    res.status(500).json({ error: 'Critical failure dispatching push notifications.' });
  }
};

exports.getRenewalReports = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        u.id, 
        u.phone, 
        u.status, 
        u.subscription_active, 
        u.subscription_expires_at, 
        u.created_at,
        v.business_name, 
        v.full_name, 
        v.address, 
        v.lat, 
        v.lng,
        v.shop_photo,
        (SELECT COUNT(*) FROM pickups WHERE vendor_id = u.id AND status = 'completed') as total_pickups,
        (SELECT SUM(final_amount) FROM pickups WHERE vendor_id = u.id AND status = 'completed') as total_earnings
      FROM users u
      LEFT JOIN vendors v ON u.id = v.user_id
      WHERE u.role = 'vendor'
      ORDER BY u.subscription_expires_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getDonationReports = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        d.*, 
        u.phone as user_phone, 
        COALESCE(u.name, 'Customer') as user_name,
        n.name as ngo_name,
        v.business_name as vendor_name,
        vu.phone as vendor_phone
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN ngos n ON d.ngo_id = n.id
      LEFT JOIN vendors v ON d.vendor_id = v.user_id
      LEFT JOIN users vu ON d.vendor_id = vu.id
      ORDER BY d.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getPickupReports = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        p.*, 
        u.phone as customer_phone, 
        COALESCE(u.name, 'Customer') as customer_name,
        v.business_name as vendor_name,
        vu.phone as vendor_phone,
        vu.name as vendor_owner_name
      FROM pickups p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN vendors v ON p.vendor_id = v.user_id
      LEFT JOIN users vu ON p.vendor_id = vu.id
      ORDER BY p.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};




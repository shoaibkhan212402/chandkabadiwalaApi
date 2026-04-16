const db = require('../config/db');
const whatsapp = require('../utils/whatsappService');
const pushService = require('../utils/pushService');
const { createNotification } = require('./notificationController');

// Haversine formula to get distance in km between two lat/lng points
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.createPickup = async (req, res) => {
  const { address, date, timeSlot, items, type, lat, lng, estimatedWeight, vehicle } = req.body;
  const userId = req.user.id;

  if (!address) return res.status(400).json({ error: 'Address is required' });
  if (!items || items.length === 0) return res.status(400).json({ error: 'Select at least one scrap item' });

  try {
    // 1. Create Pickup entry with customer coordinates
    const [pResult] = await db.execute(
      'INSERT INTO pickups (user_id, address, pickup_date, time_slot, type, status, customer_lat, customer_lng, estimated_weight_range, vehicle_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, address, date || null, timeSlot || null, type || 'sell', 'pending', lat || null, lng || null, estimatedWeight || null, vehicle || null]
    );
    const pickupId = pResult.insertId;

    // 2. Link Items
    for (const item of items) {
      if (item.weight > 0) {
        await db.execute(
          'INSERT INTO pickup_items (pickup_id, scrap_item_id, estimated_weight) VALUES (?, ?, ?)',
          [pickupId, item.id, item.weight]
        );
      }
    }

    // 3. Link Images
    if (req.body.images && req.body.images.length > 0) {
      for (const imgUrl of req.body.images) {
        await db.execute(
          'INSERT INTO pickup_images (pickup_id, image_url) VALUES (?, ?)',
          [pickupId, imgUrl]
        );
      }
    }

    // 4. Find NEAREST active vendors and notify them
    try {
      const [vendors] = await db.query(
        `SELECT u.phone, u.push_token, v.business_name, v.lat as v_lat, v.lng as v_lng, v.address as v_address
         FROM users u
         JOIN vendors v ON v.user_id = u.id
         WHERE u.role = 'vendor' AND u.status = 'active'`
      );

      // Filter vendors within 20km radius if customer gave coordinates
      let nearbyVendors = vendors;
      if (lat && lng) {
        nearbyVendors = vendors.filter(v => {
          if (v.v_lat && v.v_lng) {
            const dist = getDistanceKm(parseFloat(lat), parseFloat(lng), v.v_lat, v.v_lng);
            return dist <= 20; // 20km radius
          }
          return true; // notify vendors with no coordinates regardless
        });
        if (nearbyVendors.length === 0) nearbyVendors = vendors; // fallback: notify all
      }

      // Get item details for notification
      let itemDetailsStr = '';
      let totalApproxWeight = 0;
      try {
        const itemIds = items.map(i => i.id).filter(id => id);
        if (itemIds.length > 0) {
          const [dbItems] = await db.query(
            `SELECT id, name FROM scrap_items WHERE id IN (?)`,
            [itemIds]
          );
          items.forEach(itm => {
            const dbItm = dbItems.find(x => x.id == itm.id);
            const name = dbItm ? dbItm.name : 'Unknown Item';
            itemDetailsStr += `\n   - ${name}: ~${itm.weight}kg`;
            totalApproxWeight += Number(itm.weight) || 0;
          });
        }
      } catch (e) {
        console.error('Error fetching item details for notification', e);
      }

      if (nearbyVendors.length > 0) {
        // WhatsApp notification to each nearby vendor
        for (const vendor of nearbyVendors) {
          const msg = `🔔 *New Pickup Request!*\n\n📍 Location: ${address}\n📦 Type: ${(type || 'sell').toUpperCase()}\n📅 Date: ${date || 'ASAP'} ${timeSlot ? `| ${timeSlot}` : ''}\n\n⚖️ *Est. Weight:* ${estimatedWeight || totalApproxWeight + 'kg'}\n🚛 *Vehicle:* ${(vehicle || 'Any').toUpperCase()}\n\n♻️ *Items:*${itemDetailsStr}\n\nOpen your ChandKabadiWala app to claim this order! 🚛`;
          await whatsapp.sendMessage(vendor.phone, msg);

          // Also push notification if token exists
          if (vendor.push_token) {
            pushService.sendPushNotification(
              vendor.push_token,
              '🔔 New Pickup Near You!',
              `Location: ${address.substring(0, 30)}...\nItems: ${totalApproxWeight}kg approx.`,
              { pickupId, screen: 'PickupDetail' }
            );
          }
        }
      }
    } catch (notifErr) {
      console.error('⚠️ Vendor notification failed:', notifErr.message);
      // Don't fail the request even if notifications fail
    }

    res.status(201).json({
      success: true,
      pickupId,
      message: 'Pickup request sent! Nearby agents are being notified.'
    });
  } catch (err) {
    console.error('❌ CREATE PICKUP ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.getAvailablePickups = async (req, res) => {
  const { lat, lng } = req.query; // Vendor's current lat/lng

  try {
    const [pickups] = await db.query(`
      SELECT p.*, u.phone as customer_phone,
        GROUP_CONCAT(si.name ORDER BY si.name SEPARATOR ', ') as item_names,
        (SELECT image_url FROM pickup_images WHERE pickup_id = p.id LIMIT 1) as image_url
      FROM pickups p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN pickup_items pi ON pi.pickup_id = p.id
      LEFT JOIN scrap_items si ON si.id = pi.scrap_item_id
      WHERE p.status = 'pending'
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);

    let finalPickups = pickups;

    // Smart Match: Distance-based filtering and priority routing
    if (lat && lng && !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lng))) {
      const vendorLat = parseFloat(lat);
      const vendorLng = parseFloat(lng);

      finalPickups = pickups.map(p => {
        let distance = null;
        if (p.customer_lat && p.customer_lng) {
          distance = getDistanceKm(vendorLat, vendorLng, p.customer_lat, p.customer_lng);
        }
        return { ...p, distance };
      });

      // Priority system: Filter out far pickups (>50km cutoff) and sort by closest
      finalPickups = finalPickups.filter(p => p.distance === null || p.distance <= 50);
      finalPickups.sort((a, b) => {
        // Prioritize immediate ASAP orders or VIP status if added later
        if (a.distance === null && b.distance === null) return 0;
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      });
    }

    res.json(finalPickups);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.claimPickup = async (req, res) => {
  const { pickupId } = req.body;
  const vendorId = req.user.id;

  try {
    const [existing] = await db.execute(
      `SELECT p.status, p.user_id, u.push_token, u.phone as customer_phone, v.business_name
       FROM pickups p
       JOIN users u ON p.user_id = u.id
       LEFT JOIN vendors v ON v.user_id = ?
       WHERE p.id = ?`,
      [vendorId, pickupId]
    );

    if (!existing[0]) return res.status(404).json({ error: 'Pickup not found' });
    if (existing[0].status !== 'pending') return res.status(400).json({ error: 'Pickup already claimed' });

    await db.execute('UPDATE pickups SET status = ?, vendor_id = ? WHERE id = ?', ['accepted', vendorId, pickupId]);

    // Notify customer via push
    if (existing[0].push_token) {
      pushService.sendPushNotification(
        existing[0].push_token,
        '✅ Vendor Accepted!',
        `${existing[0].business_name || 'A vendor'} accepted your pickup and will arrive soon.`,
        { pickupId }
      );
    }

    // WhatsApp to customer
    try {
      await whatsapp.sendMessage(
        existing[0].customer_phone,
        `✅ *Pickup Accepted!*\n\nYour scrap pickup order #${pickupId} has been accepted by *${existing[0].business_name || 'our vendor'}*.\n\nThey will arrive at your location shortly! 🚛`
      );
      // Save in-app notification
      await createNotification(
        existing[0].user_id,
        '✅ Vendor Accepted Your Pickup',
        `${existing[0].business_name || 'A vendor'} accepted order #${pickupId} and will arrive shortly.`,
        'pickup',
        pickupId
      );
    } catch (_) { }

    res.json({ success: true, message: 'Pickup assigned!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getUserPickups = async (req, res) => {
  const userId = req.user.id;
  try {
    const [pickups] = await db.query(`
      SELECT p.*,
        vu.phone as vendor_phone,
        v.business_name as vendor_business_name,
        vu.name as vendor_name
      FROM pickups p
      LEFT JOIN users vu ON p.vendor_id = vu.id
      LEFT JOIN vendors v ON v.user_id = p.vendor_id
      WHERE p.user_id = ?
      ORDER BY p.created_at DESC
    `, [userId]);

    const result = await Promise.all(pickups.map(async (p) => {
      const [items] = await db.query(`
        SELECT pi.*,
          COALESCE(pi.item_name, si.name) as item_name,
          COALESCE(si.unit, 'kg') as unit,
          COALESCE(pi.rate, si.rate) as rate
        FROM pickup_items pi
        LEFT JOIN scrap_items si ON pi.scrap_item_id = si.id
        WHERE pi.pickup_id = ?
      `, [p.id]);
      const [images] = await db.query('SELECT image_url FROM pickup_images WHERE pickup_id = ?', [p.id]);
      return { ...p, items, images: images.map(i => i.image_url) };
    }));

    res.json(result);
  } catch (err) {
    console.error('❌ GET USER PICKUPS ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.updateStatus = async (req, res) => {
  const { pickupId, status } = req.body;
  // 'completed' can only be set via finalizeBilling — not directly
  const validStatuses = ['pending', 'accepted', 'on_the_way', 'reached', 'started', 'cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Allowed: ${validStatuses.join(', ')}` });
  }

  try {
    const [pRows] = await db.query(
      'SELECT p.*, u.phone, u.push_token FROM pickups p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
      [pickupId]
    );
    const pickup = pRows[0];
    if (!pickup) return res.status(404).json({ error: 'Pickup not found' });

    // === Authorization Guard ===
    const callerId = req.user.id;
    const callerRole = req.user.role;
    if (status === 'cancelled') {
      // Both customer (their own order) and vendor (their assigned order) can cancel
      if (Number(pickup.user_id) !== Number(callerId) && Number(pickup.vendor_id) !== Number(callerId) && callerRole !== 'admin') {
        return res.status(403).json({ error: 'You are not authorized to cancel this pickup.' });
      }
    } else {
      // Only the assigned vendor can change status
      if (Number(pickup.vendor_id) !== Number(callerId) && callerRole !== 'admin') {
        return res.status(403).json({ error: 'Only the assigned vendor can update this pickup status.' });
      }
    }

    await db.execute('UPDATE pickups SET status = ? WHERE id = ?', [status, pickupId]);

    const msgMap = {
      accepted: { title: '✅ Order Accepted!', body: 'A vendor has accepted your request.' },
      on_the_way: { title: '🚛 Vendor is on the way!', body: 'Track your vendor on the map.' },
      reached: { title: '📍 Vendor Reached!', body: 'Your vendor has arrived at your location.' },
      started: { title: '⚖️ Weight Started', body: 'Vendor is now weighing your scrap.' },
      completed: { title: '🎁 Pickup Completed', body: 'Your scrap has been collected and paid for.' },
      cancelled: { title: '❌ Pickup Cancelled', body: `Your pickup #${pickupId} has been cancelled.` },
    };

    if (pickup.push_token && msgMap[status]) {
      pushService.sendPushNotification(pickup.push_token, msgMap[status].title, msgMap[status].body, { pickupId });
    }

    try {
      if (msgMap[status]) {
        await whatsapp.sendMessage(pickup.phone,
          `${msgMap[status].title}\n\n${msgMap[status].body}\n\nPickup Order #${pickupId}`
        );

        await createNotification(
          pickup.user_id,
          msgMap[status].title,
          msgMap[status].body,
          'pickup',
          pickupId
        );
      }

      // === Extra: Notify vendor when CUSTOMER cancels an accepted order ===
      if (status === 'cancelled' && callerId === pickup.user_id && pickup.vendor_id) {
        const [vendorRows] = await db.query(
          'SELECT u.push_token, u.phone FROM users u WHERE u.id = ?',
          [pickup.vendor_id]
        );
        const vendor = vendorRows[0];
        if (vendor) {
          // Push notification
          if (vendor.push_token) {
            pushService.sendPushNotification(
              vendor.push_token,
              '❌ Customer Cancelled Order',
              `Pickup #${pickupId} has been cancelled by the customer. Please do not proceed to the location.`,
              { pickupId }
            );
          }
          // WhatsApp notification
          await whatsapp.sendMessage(
            vendor.phone,
            `❌ *Order Cancelled by Customer*\n\nPickup Order #${pickupId} has been cancelled by the customer.\n\nPlease do NOT proceed to the location. The order is no longer active.`
          );
          // In-app notification
          await createNotification(
            pickup.vendor_id,
            '❌ Customer Cancelled Order',
            `Pickup #${pickupId} was cancelled by the customer.`,
            'pickup',
            pickupId
          );
        }
      }
    } catch (_) { }

    res.json({ success: true, message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateLocation = async (req, res) => {
  const { pickupId, lat, lng } = req.body;
  const callerId = req.user.id;
  try {
    // Only the assigned vendor can update location
    const [pRows] = await db.query('SELECT vendor_id FROM pickups WHERE id = ?', [pickupId]);
    if (!pRows[0]) return res.status(404).json({ error: 'Pickup not found' });
    if (Number(pRows[0].vendor_id) !== Number(callerId)) {
      return res.status(403).json({ error: 'Only the assigned vendor can update location.' });
    }
    await db.execute('UPDATE pickups SET vendor_lat = ?, vendor_lng = ? WHERE id = ?', [lat, lng, pickupId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Finalize Bill with Actual Weights
exports.finalizeBilling = async (req, res) => {
  const { pickupId, items } = req.body;
  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // === Authorization Guard: only assigned vendor ===
    const [authRows] = await connection.query('SELECT vendor_id FROM pickups WHERE id = ?', [pickupId]);
    if (!authRows[0]) { await connection.rollback(); connection.release(); return res.status(404).json({ error: 'Pickup not found' }); }
    if (Number(authRows[0].vendor_id) !== Number(req.user.id) && req.user.role !== 'admin') {
      await connection.rollback(); connection.release();
      return res.status(403).json({ error: 'Only the assigned vendor can finalize billing.' });
    }

    let totalBill = 0;
    const billBreakdown = [];

    // 1. Clear existing bill items to allow removals/replacements
    await connection.execute('DELETE FROM pickup_items WHERE pickup_id = ?', [pickupId]);

    for (const item of items) {
      const [scrapItems] = await connection.execute('SELECT name, rate, unit FROM scrap_items WHERE id = ?', [item.id]);
      const scrap = scrapItems[0];
      if (!scrap) continue;

      const weight = parseFloat(item.weight) || 0;
      const rate = parseFloat(scrap.rate) || 0;
      const subtotal = weight * rate;

      totalBill += subtotal;
      billBreakdown.push({ name: scrap.name, weight, rate, subtotal });

      // Upsert into pickup_items
      await connection.execute(
        `INSERT INTO pickup_items (pickup_id, scrap_item_id, item_name, weight, rate, subtotal, actual_weight, rate_at_collection) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE weight = VALUES(weight), rate = VALUES(rate), subtotal = VALUES(subtotal), actual_weight = VALUES(actual_weight), rate_at_collection = VALUES(rate_at_collection)`,
        [pickupId, item.id, scrap.name, weight, rate, subtotal, weight, rate]
      );
    }

    // 3. Update main pickup bill & status
    await connection.execute('UPDATE pickups SET total_bill = ?, status = "completed" WHERE id = ?', [totalBill.toFixed(2), pickupId]);

    // 4. Handle post-billing logic based on pickup type
    let createdDonationId = null;
    const [freshPickup] = await connection.query('SELECT type, user_id, vendor_id FROM pickups WHERE id = ?', [pickupId]);
    const p = freshPickup[0];

    if (p && p.type === 'donate') {
      // --- DONATE FLOW: Create pending NGO donation record ---
      const [ngos] = await connection.query('SELECT id FROM ngos WHERE is_active = 1 LIMIT 1');
      const ngoId = ngos[0] ? ngos[0].id : null;
      const itemsSummary = billBreakdown.map(b => `${b.name}: ${b.weight}kg`).join(', ');

      const [userRes] = await connection.query('SELECT name FROM users WHERE id = ?', [p.user_id]);
      const donorName = (userRes[0] && userRes[0].name) ? userRes[0].name : 'Generous Donor';
      const certId = 'PENDING-' + Date.now();

      const [donResult] = await connection.execute(
        'INSERT INTO donations (pickup_id, user_id, vendor_id, ngo_id, items_summary, estimated_value, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [pickupId, p.user_id, req.user.id, ngoId, itemsSummary, totalBill, 'pending']
      );
      createdDonationId = donResult.insertId;

      // Link donation back to pickup
      await connection.execute('UPDATE pickups SET donation_id = ? WHERE id = ?', [createdDonationId, pickupId]);
      console.log(`✅ [DONATE] Donation #${createdDonationId} created for Pickup #${pickupId}, Amount=₹${totalBill}, VendorID=${req.user.id}`);

      // TRIGGER IMMEDIATE CERTIFICATE
      try {
        const donationController = require('./donationController');
        await donationController.generateCertificate({ params: { donationId: createdDonationId } }, { json: () => {}, status: () => ({ json: () => {} }), headersSent: true });
        console.log(`📡 [CERT] Immediate certificate triggered for Pickup #${pickupId}`);
      } catch(certErr) {
        console.error('❌ [CERT] Error during immediate issuance:', certErr.message);
      }
    } else if (p && p.type === 'sell') {
      // --- SELL FLOW: WE DO NOT CREDIT WALLET HERE ANYMORE ---
      // Wallet payout is now deferred until the customer confirms 'Payment Received'
      // This allows the customer to choose to donate even after the bill is finalized.
      console.log(`ℹ️ [SELL] Bill finalized for Pickup #${pickupId}. Awaiting customer choice (Sell vs Donate).`);
    }

    await connection.commit();
    res.json({ success: true, message: 'Billing finalized', donationId: createdDonationId });
  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Finalize Billing Error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
};

// Recovery: ensure a donation record exists for a completed donate pickup
exports.ensureDonation = async (req, res) => {
  const { pickupId } = req.body;
  if (!pickupId) return res.status(400).json({ error: 'pickupId required' });

  try {
    // 1. Get pickup
    const [pRows] = await db.query('SELECT * FROM pickups WHERE id = ?', [pickupId]);
    const pickup = pRows[0];
    if (!pickup) return res.status(404).json({ error: 'Pickup not found' });
    if (pickup.type !== 'donate') return res.status(400).json({ error: 'Pickup is not a donation type' });

    // 2. Check if donation already exists
    const [existing] = await db.query('SELECT id FROM donations WHERE pickup_id = ?', [pickupId]);
    if (existing[0]) {
      // Link it back to pickup if missing
      await db.execute('UPDATE pickups SET donation_id = ? WHERE id = ?', [existing[0].id, pickupId]);
      console.log(`✅ [RECOVER] Existing donation #${existing[0].id} re-linked to Pickup #${pickupId}`);
      return res.json({ success: true, donationId: existing[0].id, recovered: true });
    }

    // 3. Calculate from pickup_items
    const [items] = await db.query(
      'SELECT pi.*, COALESCE(pi.weight, 0) as w, COALESCE(pi.rate, si.rate, 0) as r, COALESCE(pi.item_name, si.name) as name FROM pickup_items pi LEFT JOIN scrap_items si ON si.id = pi.scrap_item_id WHERE pi.pickup_id = ?',
      [pickupId]
    );
    const totalBill = items.reduce((s, i) => s + (parseFloat(i.w) * parseFloat(i.r)), 0);
    const itemsSummary = items.map(i => `${i.name}: ${i.w}kg`).join(', ');

    if (totalBill <= 0) return res.status(400).json({ error: 'Cannot create donation — no items or zero amount. Please re-finalize the bill.' });

    // 4. Get NGO
    const [ngos] = await db.query('SELECT id FROM ngos WHERE is_active = 1 LIMIT 1');
    const ngoId = ngos[0]?.id || null;

    const [userRes] = await db.query('SELECT name FROM users WHERE id = ?', [pickup.user_id]);
    const donorName = (userRes[0] && userRes[0].name) ? userRes[0].name : 'Generous Donor';
    const certId = 'PENDING-' + Date.now();

    // 5. Create donation
    const [donResult] = await db.execute(
      'INSERT INTO donations (pickup_id, user_id, vendor_id, ngo_id, items_summary, estimated_value, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [pickupId, pickup.user_id, req.user.id, ngoId, itemsSummary, totalBill, 'pending']
    );
    const donationId = donResult.insertId;

    // 6. Link to pickup
    await db.execute('UPDATE pickups SET donation_id = ?, total_bill = ? WHERE id = ?', [donationId, totalBill.toFixed(2), pickupId]);
    console.log(`✅ [RECOVER] Donation #${donationId} created for Pickup #${pickupId}, Amount=₹${totalBill}`);

    res.json({ success: true, donationId, recovered: false, amount: totalBill });
  } catch (err) {
    console.error('❌ EnsureDonation Error:', err);
    res.status(500).json({ error: err.message });
  }
};

// @route   POST /api/pickups/convert-to-donation
// @desc    Customer chooses to donate the finalized bill amount instead of taking cash
exports.convertPickupToDonation = async (req, res) => {
    const { pickupId } = req.body;
    const userId = req.user.id;

    try {
        // 1. Verify pickup exists and is in 'completed' (finalized) status
        const [rows] = await db.query('SELECT * FROM pickups WHERE id = ?', [pickupId]);
        const pickup = rows[0];
        if (!pickup) return res.status(404).json({ error: 'Pickup not found' });
        
        // 2. Security: Only the customer who owns this pickup can donate it
        if (Number(pickup.user_id) !== Number(userId)) {
            return res.status(403).json({ error: 'Unauthorized: You can only donate your own pickups.' });
        }

        if (pickup.status !== 'completed') {
            return res.status(400).json({ error: 'Bill must be finalized before you can donate it.' });
        }

        if (pickup.type === 'donate' && pickup.donation_id) {
            return res.status(400).json({ error: 'This pickup is already set as a donation.' });
        }

        // 3. Switch type to donate
        await db.execute('UPDATE pickups SET type = "donate" WHERE id = ?', [pickupId]);

        // 4. Create the donation record for the vendor to pay
        const [items] = await db.query(
            'SELECT pi.*, COALESCE(pi.weight, 0) as w, COALESCE(pi.rate, si.rate, 0) as r, COALESCE(pi.item_name, si.name) as name FROM pickup_items pi LEFT JOIN scrap_items si ON si.id = pi.scrap_item_id WHERE pi.pickup_id = ?',
            [pickupId]
        );
        const totalBill = parseFloat(pickup.total_bill) || items.reduce((s, i) => s + (parseFloat(i.w) * parseFloat(i.r)), 0);
        const itemsSummary = items.map(i => `${i.name}: ${i.w}kg`).join(', ');

        const [ngos] = await db.query('SELECT id FROM ngos WHERE is_active = 1 LIMIT 1');
        const ngoId = ngos[0]?.id || null;

        const [donResult] = await db.execute(
            'INSERT INTO donations (pickup_id, user_id, vendor_id, ngo_id, items_summary, estimated_value, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [pickupId, pickup.user_id, pickup.vendor_id, ngoId, itemsSummary, totalBill, 'pending']
        );
        const donationId = donResult.insertId;

        // 5. Link donation back to pickup
        await db.execute('UPDATE pickups SET donation_id = ? WHERE id = ?', [donationId, pickupId]);

        // 6. IMMEDIATE CERTIFICATE (Don't wait for vendor payout)
        try {
            const donationController = require('./donationController');
            await donationController.generateCertificate({ params: { donationId } }, { json: () => {}, status: () => ({ json: () => {} }), headersSent: true });
        } catch(certErr) {
            console.error('Immediate Donation Cert Error:', certErr.message);
        }

        console.log(`♻️ Pickup #${pickupId} converted to Donation #${donationId} by Customer #${userId}`);
        res.json({ success: true, message: 'Thank you! This pickup has been converted to a donation.', donationId });

    } catch (err) {
        console.error('❌ Convert to Donation Error:', err);
        res.status(500).json({ error: 'Failed to convert pickup to donation' });
    }
};


// Dual Confirmation Payment
exports.confirmPayment = async (req, res) => {
  const { pickupId } = req.body;
  // SECURITY: Use the server-verified role from JWT, NEVER trust client-provided role
  const role = req.user.role; // 'vendor' or 'customer'
  try {
    // Verify caller is actually associated with this pickup
    const [pRows] = await db.query('SELECT user_id, vendor_id FROM pickups WHERE id = ?', [pickupId]);
    if (!pRows[0]) return res.status(404).json({ error: 'Pickup not found' });
    const pickup = pRows[0];
    const callerId = req.user.id;

    if (role === 'vendor' && Number(pickup.vendor_id) !== Number(callerId)) {
      return res.status(403).json({ error: 'You are not the assigned vendor for this pickup.' });
    }
    if (role === 'customer' && Number(pickup.user_id) !== Number(callerId)) {
      return res.status(403).json({ error: 'You are not the customer for this pickup.' });
    }

    const field = role === 'vendor' ? 'vendor_confirmed' : 'customer_confirmed';
    await db.execute(`UPDATE pickups SET ${field} = TRUE WHERE id = ?`, [pickupId]);

    // Check if both confirmed
    const [updated] = await db.execute('SELECT vendor_confirmed, customer_confirmed FROM pickups WHERE id = ?', [pickupId]);

    if (updated[0].vendor_confirmed && updated[0].customer_confirmed) {
      // 1. Mark as paid (Idempotent check: only proceed if status was NOT 'paid')
      const [statusUpdate] = await db.execute(
        'UPDATE pickups SET payment_status = "paid" WHERE id = ? AND payment_status != "paid"', 
        [pickupId]
      );

      if (statusUpdate.affectedRows > 0) {
        // 2. If it's a SELL type, trigger the wallet transaction NOW (on final confirmation)
        const [finalPickup] = await db.query('SELECT type, user_id, vendor_id, total_bill FROM pickups WHERE id = ?', [pickupId]);
        const p = finalPickup[0];

        if (p && p.type === 'sell' && parseFloat(p.total_bill) > 0) {
          const walletController = require('./walletController');
          const amount = parseFloat(p.total_bill);
          
          // Payout to customer wallet (credited)
          await walletController.addTransaction(p.user_id, 'credit', 'pickup', pickupId, amount, `Payout for scrap pickup #${pickupId}`);
          // Deduct from vendor wallet (debited)
          await walletController.addTransaction(p.vendor_id, 'debit', 'pickup', pickupId, amount, `Payment for buying scrap pickup #${pickupId}`);
          
          console.log(`💰 [PAYMENT] Wallets adjusted after Dual Confirmation for Pickup #${pickupId}: ₹${amount}`);
        }
      }

      // 3. Send Final Detailed Bill via WhatsApp
      try {
        const [customer] = await db.query('SELECT phone FROM users WHERE id = ?', [p.user_id]);
        const phone = customer[0]?.phone;
        if (phone) {
          const [items] = await db.query(`
            SELECT pi.item_name, pi.weight, pi.rate, (pi.weight * pi.rate) as subtotal, si.unit
            FROM pickup_items pi
            LEFT JOIN scrap_items si ON si.id = pi.scrap_item_id
            WHERE pi.pickup_id = ?
          `, [pickupId]);

          let itemSummary = items.map(it => 
            `▫️ *${it.item_name}*: ${it.weight}${it.unit || 'kg'} x ₹${it.rate} = *₹${parseFloat(it.subtotal).toFixed(2)}*`
          ).join('\n');

          const finalMsg = 
            `🧾 *OFFICIAL BILL - #${pickupId}*\n\n` +
            `Thank you for choosing Chand Kabadi Wala. Your order is now completed and verified.\n\n` +
            `*ITEMS COLLECTED:*\n${itemSummary}\n\n` +
            `---------------------------\n` +
            `💰 *GRAND TOTAL: ₹${parseFloat(p.total_bill).toFixed(2)}*\n` +
            `---------------------------\n\n` +
            `${p.type === 'donate' ? '💚 *This collection was donated to NGO.*' : '✅ *Payment/Payout has been processed.*'}\n\n` +
            `Download the app to view history:\nhttps://chandkabadiwala.com/app\n\n` +
            `— Chand Kabadi Wala ♻️`;

          const whatsapp = require('../utils/whatsappService');
          await whatsapp.sendMessage(phone, finalMsg);
          console.log(`📡 [BILL] Detailed WhatsApp bill sent to ${phone}`);
        }
      } catch (waErr) {
        console.error('❌ Bill Delivery Error:', waErr.message);
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getVendorPickups = async (req, res) => {
  // Try to get ID from token (preferred) or URL params (fallback)
  const vendorId = req.user?.id || req.params.vendorId;

  if (!vendorId) {
    return res.status(400).json({ error: 'Vendor ID is required to fetch pickups.' });
  }

  console.log('📡 [DEBUG] Fetching pickups for Vendor ID:', vendorId);
  try {
    const [rows] = await db.query(`
      SELECT p.*, u.phone as customer_phone,
        GROUP_CONCAT(COALESCE(si.name, '') SEPARATOR ', ') as item_names,
        (SELECT image_url FROM pickup_images WHERE pickup_id = p.id LIMIT 1) as image_url
      FROM pickups p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN pickup_items pi ON pi.pickup_id = p.id
      LEFT JOIN scrap_items si ON si.id = pi.scrap_item_id
      WHERE p.vendor_id = ?
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `, [vendorId]);

    console.log(`✅ [DEBUG] Found ${rows.length} pickups for vendor.`);
    res.json(rows || []);
  } catch (err) {
    console.error('❌ FETCH VENDOR PICKUPS ERROR:', err);
    res.status(500).json({
      error: 'Could not fetch your pickup history.',
      details: err.message
    });
  }
};

exports.getPickupById = async (req, res) => {
  const { pickupId } = req.params;
  if (!pickupId) return res.status(400).json({ error: 'pickupId is required' });

  try {
    const [pRows] = await db.query(
      `SELECT p.*,
          cu.phone as customer_phone, cu.name as customer_name,
          vu.phone as vendor_phone, vu.name as vendor_name,
          v.business_name as vendor_business_name, v.address as vendor_address,
          v.lat as vendor_store_lat, v.lng as vendor_store_lng,
          d.id as donation_id, d.certificate_url, d.certificate_sent,
          r.rating as existing_rating, r.comment as existing_comment
       FROM pickups p
       LEFT JOIN users cu ON p.user_id = cu.id
       LEFT JOIN users vu ON p.vendor_id = vu.id
       LEFT JOIN vendors v ON v.user_id = p.vendor_id
       LEFT JOIN donations d ON d.pickup_id = p.id
       LEFT JOIN reviews r ON r.pickup_id = p.id
       WHERE p.id = ?`,
      [pickupId]
    );

    if (!pRows || pRows.length === 0) {
      return res.status(404).json({ error: 'Pickup not found' });
    }

    const [items] = await db.query(
      `SELECT pi.*,
          COALESCE(pi.item_name, si.name) as item_name,
          COALESCE(si.unit, 'kg') as unit,
          COALESCE(pi.rate, si.rate) as rate
       FROM pickup_items pi
       LEFT JOIN scrap_items si ON pi.scrap_item_id = si.id
       WHERE pi.pickup_id = ?`,
      [pickupId]
    );

    const [images] = await db.query('SELECT image_url FROM pickup_images WHERE pickup_id = ?', [pickupId]);

    const pickupData = { ...pRows[0], items, images: images.map(i => i.image_url) };

    // AUTO-RECOVERY for missing certificates on old orders
    if (pickupData.type === 'donate' && (pickupData.status === 'completed' || pickupData.payment_status === 'paid') && pickupData.donation_id && !pickupData.certificate_url) {
        try {
            console.log(`🔄 [RECOVER] Auto-generating missing certificate for Pickup #${pickupId}`);
            const donationController = require('./donationController');
            await donationController.generateCertificate({ params: { donationId: pickupData.donation_id } }, { json: () => {}, status: () => ({ json: () => {} }), headersSent: true });
            
            // Re-fetch to update the response
            const [updated] = await db.query('SELECT certificate_url FROM donations WHERE id = ?', [pickupData.donation_id]);
            if (updated[0]) pickupData.certificate_url = updated[0].certificate_url;
        } catch(recErr) {
            console.error('[RECOVER] Error during auto-issuance:', recErr.message);
        }
    }

    res.json(pickupData);
  } catch (err) {
    console.error('❌ GET PICKUP BY ID ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

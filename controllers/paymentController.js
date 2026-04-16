const razorpay = require('../config/razorpay');
const crypto = require('crypto');
const db = require('../config/db');
const { env } = require('../config/env');

// Create subscription order for vendor
exports.createSubscriptionOrder = async (req, res) => {
  const { amount } = req.body; // Amount should be 49900 (in paise)
  const vendorId = req.user.id;

  try {
    const options = {
      amount: amount || 49900, 
      currency: 'INR',
      receipt: `sub_${vendorId}_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error('Razorpay Order Error:', err);
    res.status(500).json({ error: 'Failed to initiate payment' });
  }
};

// Verify payment and update vendor subscription
exports.verifySubscriptionPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const vendorId = req.user.id;

  try {
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpayKeySecret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // Payment Verified — Update vendor subscription
      const expires = new Date();
      expires.setMonth(expires.getMonth() + 1); // Add 1 month

      await db.execute(
        'UPDATE users SET subscription_active = 1, subscription_expires_at = ? WHERE id = ?',
        [expires, vendorId]
      );

      // Record transaction for revenue tracking
      const walletCtrl = require('./walletController');
      // Ensure wallet exists (creates if missing) before recording the transaction
      const wallet = await walletCtrl.getWallet(vendorId);
      await db.execute(
        'INSERT INTO transactions (wallet_id, type, entity, amount, description) VALUES (?, "credit", "subscription", ?, "Monthly subscription payment")',
        [wallet.id, 499.00]
      );

      res.json({ success: true, message: 'Subscription activated' });
    } else {
      res.status(400).json({ error: 'Invalid payment signature' });
    }
  } catch (err) {
    console.error('Verification Error:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
};
// Create donation payout order
exports.createDonationOrder = async (req, res) => {
  const { donationId } = req.body;
  if (!donationId) return res.status(400).json({ error: 'donationId is required' });
  
  try {
    const [dRows] = await db.query('SELECT id, estimated_value, status FROM donations WHERE id = ?', [donationId]);
    if (!dRows[0]) return res.status(404).json({ error: 'Donation record not found. Please finalize the bill first.' });
    if (dRows[0].status === 'paid') return res.status(400).json({ error: 'This donation is already paid.' });

    const amountPaise = Math.round(parseFloat(dRows[0].estimated_value) * 100);
    if (!amountPaise || amountPaise <= 0) return res.status(400).json({ error: 'Invalid donation amount. Please finalize the bill with valid weights.' });

    console.log(`💳 Creating Razorpay Order for Donation #${donationId}, Amount=₹${dRows[0].estimated_value} (${amountPaise} paise)`);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `don_${donationId}_${Date.now()}`,
    });
    res.json(order);
  } catch (err) {
    console.error('Razorpay Donation Order Error:', err);
    res.status(500).json({ error: 'Failed to initiate donation payment' });
  }
};

// Verify donation payment
exports.verifyDonationPayment = async (req, res) => {
  const { donationId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const vendorId = req.user.id;

  try {
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpayKeySecret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      const [donations] = await db.query('SELECT pickup_id FROM donations WHERE id = ?', [donationId]);
      const pId = donations[0]?.pickup_id;

      await db.execute(
        'UPDATE donations SET status = "paid", is_approved = 1, paid_at = CURRENT_TIMESTAMP, transaction_id = ? WHERE id = ?',
        [razorpay_payment_id, donationId]
      );

      if (pId) {
          await db.execute('UPDATE pickups SET vendor_confirmed = 1 WHERE id = ?', [pId]);
          
          // Record as debit for vendor
          const [pDetails] = await db.query('SELECT total_bill FROM pickups WHERE id = ?', [pId]);
          const amount = pDetails[0]?.total_bill || 0;
          await db.execute(
             'INSERT INTO transactions (wallet_id, type, entity, entity_id, amount, description) VALUES ((SELECT id FROM wallets WHERE user_id = ?), "debit", "donation", ?, ?, ?)',
             [vendorId, pId, amount, `Instant NGO payout for order #${pId}`]
          );

          // AUTO-GENERATE CERTIFICATE
          try {
            const donationController = require('./donationController');
            await donationController.generateCertificate({ params: { donationId } }, { json: () => {}, status: () => ({ json: () => {} }), headersSent: true });
          } catch(certErr) {
            console.error('Auto-Cert Error:', certErr.message);
          }
      }

      res.json({ success: true, message: 'Donation payment successful and verified' });
    } else {
      res.status(400).json({ error: 'Invalid donation payment signature' });
    }
  } catch (err) {
    console.error('Donation Verification Error:', err);
    res.status(500).json({ error: 'Failed to verify donation payment' });
  }
};

// Create bulk donation order
exports.createBulkDonationOrder = async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

  try {
    const options = {
      amount: Math.round(parseFloat(amount) * 100),
      currency: 'INR',
      receipt: `bulk_don_${req.user.id}_${Date.now()}`,
    };

    const order = await razorpay.orders.create(options);
    res.json(order);
  } catch (err) {
    console.error('Bulk Donation Order Error:', err);
    res.status(500).json({ error: 'Failed to initiate bulk payment' });
  }
};

// Verify bulk donation payment
exports.verifyBulkDonationPayment = async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const vendorId = req.user.id;

  try {
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', env.razorpayKeySecret)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature === razorpay_signature) {
      // 1. Get all pending donations
      const [pendings] = await db.query('SELECT id, pickup_id, estimated_value FROM donations WHERE vendor_id = ? AND status = "pending"', [vendorId]);
      
      // 2. Update ALL to paid in one go
      await db.execute(
        'UPDATE donations SET status = "paid", is_approved = 1, paid_at = CURRENT_TIMESTAMP, transaction_id = ? WHERE vendor_id = ? AND status = "pending"',
        [razorpay_payment_id, vendorId]
      );

      // 3. Record transactions for each & Send Certificates
      for (const don of pendings) {
          await db.execute(
            'INSERT INTO transactions (wallet_id, type, entity, entity_id, amount, description) VALUES ((SELECT id FROM wallets WHERE user_id = ?), "debit", "donation", ?, ?, ?)',
            [vendorId, don.pickup_id, don.estimated_value, `Bulk NGO payout for order #${don.pickup_id}`]
          );

          // AUTO-GENERATE CERTIFICATE
          try {
            const donationController = require('./donationController');
            await donationController.generateCertificate({ params: { donationId: don.id } }, { json: () => {}, status: () => ({ json: () => {} }), headersSent: true });
          } catch(certErr) {
            console.error('Auto-Cert Error (Bulk):', certErr.message);
          }
      }

      res.json({ success: true, message: 'Bulk payment successful' });
    } else {
      res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Bulk Verify Error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
};

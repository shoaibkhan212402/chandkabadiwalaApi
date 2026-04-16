const db = require('../config/db');
const whatsapp = require('../utils/whatsappService');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Create a donation record when a pickup is marked as donation
exports.createDonation = async (req, res) => {
  const { pickupId, items } = req.body;
  const userId = req.user.id;

  try {
    // Calculate estimated value from items
    let totalValue = 0;
    let itemsSummary = [];

    for (const item of items) {
      const [scrapRows] = await db.query('SELECT name, rate FROM scrap_items WHERE id = ?', [item.id]);
      if (scrapRows[0]) {
        const value = (scrapRows[0].rate * (item.weight || 0));
        totalValue += value;
        itemsSummary.push(`${scrapRows[0].name}: ${item.weight || 0}kg (₹${value.toFixed(2)})`);
      }
    }

    const [result] = await db.execute(
      'INSERT INTO donations (pickup_id, user_id, items_summary, estimated_value) VALUES (?, ?, ?, ?)',
      [pickupId || null, userId, itemsSummary.join(', '), totalValue]
    );

    res.status(201).json({
      success: true,
      donationId: result.insertId,
      estimated_value: totalValue,
      message: 'Donation recorded! Thank you for your generosity 🙏'
    });
  } catch (err) {
    console.error('❌ CREATE DONATION ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get user's donation history
exports.getUserDonations = async (req, res) => {
  const userId = req.user.id;

  try {
    const [donations] = await db.query(
      'SELECT * FROM donations WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    res.json(donations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get single donation detail
exports.getDonationById = async (req, res) => {
  const { donationId } = req.params;

  try {
    console.log(`📡 Fetching donation detail for ID: ${donationId}`);
    const [donations] = await db.query(`
      SELECT d.*, u.phone as customer_phone, 
             COALESCE(n.name, 'NGO/Admin Payout') as ngo_name, 
             'chandkabadi@ybl' as ngo_upi, 
             COALESCE(n.address, 'Admin Office') as ngo_address
      FROM donations d
      LEFT JOIN users u ON d.user_id = u.id
      LEFT JOIN ngos n ON d.ngo_id = n.id
      WHERE d.id = ?
    `, [donationId]);

    if (!donations[0]) {
      console.log(`⚠️ Donation ${donationId} not found in database.`);
      return res.status(404).json({ error: 'Donation not found' });
    }
    console.log(`✅ Found donation for pickup: ${donations[0].pickup_id}`);
    res.json(donations[0]);
  } catch (err) {
    console.error(`❌ GET DONATION BY ID ERROR (ID: ${donationId}):`, err.message);
    res.status(500).json({ error: err.message });
  }
};

// Admin: Get all donations
exports.getAllDonations = async (req, res) => {
  try {
    const [donations] = await db.query(`
      SELECT d.*, 
             u.phone as donor_phone, u.name as donor_name,
             v.business_name as vendor_name, v.full_name as vendor_owner
      FROM donations d 
      JOIN users u ON d.user_id = u.id 
      LEFT JOIN vendors v ON d.vendor_id = v.user_id
      ORDER BY d.created_at DESC
    `);


    // Calculate aggregate stats
    const [stats] = await db.query(`
      SELECT 
        COUNT(*) as total_donations,
        SUM(estimated_value) as total_value,
        COUNT(DISTINCT user_id) as unique_donors
      FROM donations
    `);

    res.json({ donations, stats: stats[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Generate donation certificate
exports.generateCertificate = async (req, res) => {
  const { donationId } = req.params;
  console.log(`📜 [CERT] Generating certificate for Donation ID: ${donationId}`);

  try {
    const [rows] = await db.query(
      `SELECT d.*, u.phone, u.name as customer_name, n.name as ngo_name 
       FROM donations d 
       JOIN users u ON d.user_id = u.id 
       LEFT JOIN ngos n ON d.ngo_id = n.id
       WHERE d.id = ?`,
      [donationId]
    );

    if (!rows[0]) {
      if (res.headersSent) return;
      return res.status(404).json({ error: 'Donation not found' });
    }

    const donation = rows[0];
    const donationId_str = String(donation.id);
    const certNumber = `CKW-DON-${donationId_str.padStart(6, '0')}`;

    // --- PDF Generation Logic ---
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const fileName = `certificate_${donationId}.pdf`;
    const certPath = path.join(uploadDir, fileName);
    const publicUrl = `/uploads/${fileName}`;

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const writeStream = fs.createWriteStream(certPath);
    doc.pipe(writeStream);

    // --- Premium Certificate Design ---
    const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
    const signaturePath = path.join(__dirname, '..', 'assets', 'signature.png');

    // Background Border
    doc.rect(20, 20, 555, 782).lineWidth(2).strokeColor('#10b981').stroke();
    doc.rect(25, 25, 545, 772).lineWidth(0.5).strokeColor('#10b981').stroke();

    // Logo (if exists)
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 245, 45, { width: 100 });
      doc.moveDown(6);
    } else {
      doc.moveDown(4);
    }

    // Title
    doc.fontSize(32).fillColor('#065f46').text('CERTIFICATE OF APPRECIATION', { align: 'center', characterSpacing: 1 });
    doc.moveDown(0.5);
    doc.fontSize(14).fillColor('#666666').text('Presented to a Valued Eco-Warrior', { align: 'center' });

    doc.moveDown(2);
    doc.fontSize(20).fillColor('#111827').text(`This certificate is proudly presented to`, { align: 'center' });
    doc.moveDown(0.8);

    // Donor Name
    doc.fontSize(28).fillColor('#10b981').text(donation.customer_name || 'Valued Donor', { align: 'center', underline: true });
    doc.moveDown(1.5);

    doc.fontSize(15).fillColor('#374151').text(
      `For their generous contribution of scrap materials valued at Rs. ${parseFloat(donation.estimated_value).toFixed(2)}. Your commitment to recycling helps us build a cleaner, greener India and supports our NGO partners (${donation.ngo_name || 'Partner NGOs'}) in their noble cause.`,
      { align: 'center', width: 450, indent: 0, lineGap: 5 }
    );

    doc.moveDown(2);

    // Contribution details
    doc.fontSize(12).fillColor('#6B7280').text('CONTRIBUTION DETAILS:', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor('#4B5563').text(donation.items_summary || 'Multiple Scrap Items', { align: 'center', width: 400 });

    doc.moveDown(3);

    // Signature & Date
    const bottomY = doc.y > 650 ? 650 : doc.y;

    // Date on left
    doc.fontSize(12).fillColor('#111827').text(`Date: ${new Date(donation.created_at).toLocaleDateString()}`, 100, bottomY + 40);
    doc.text('____________________', 100, bottomY + 45);
    doc.fontSize(10).fillColor('#9ca3af').text('Issued Date', 100, bottomY + 60);

    // Signature on right
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 380, bottomY, { width: 120 });
    }
    doc.fontSize(12).fillColor('#111827').text('____________________', 380, bottomY + 45);
    doc.fontSize(10).fillColor('#111827').text('Founder, ChandKabadiWala', 380, bottomY + 60);

    doc.moveDown(4);
    doc.fontSize(10).fillColor('#9ca3af').text(`Certificate ID: ${certNumber}`, { align: 'center' });

    doc.end();

    await new Promise(resolve => writeStream.on('finish', resolve));

    // Update DB with the public URL
    await db.execute(
      'UPDATE donations SET certificate_url = ? WHERE id = ?',
      [publicUrl, donationId]
    );
    console.log(`✅ [CERT] Certificate URL updated in DB: ${publicUrl}`);

    // Send via WhatsApp
    try {
      const msg = `🌟 *Thank You for Donating!*\n\n` +
        `Your contribution has been successfully verified.\n\n` +
        `🆔 Certificate No: ${certNumber}\n` +
        `💰 Amount: ₹${parseFloat(donation.estimated_value).toFixed(2)}\n\n` +
        `We have generated your formal Donation Certificate. Please find it attached.\n` +
        `Thanks to your contribution, materials have been directed towards social good! 💚\n\n` +
        `— Chand Kabadi Wala ♻️`;

      await whatsapp.sendDocument(donation.phone, certPath, `Donation_Certificate_${donationId}.pdf`, msg);
      await db.execute('UPDATE donations SET certificate_sent = 1 WHERE id = ?', [donationId]);
    } catch (waErr) {
      console.error('WhatsApp certificate delivery failed:', waErr.message);
    }

    if (res.headersSent) return;
    res.json({ success: true, certificate_url: publicUrl });
  } catch (err) {
    if (res.headersSent) return;
    res.status(500).json({ error: err.message });
  }
};

// Vendor: Mark as paid with proof
exports.markDonationPaid = async (req, res) => {
  const { donationId } = req.params;
  const { transactionId, proofImage } = req.body;

  if (!transactionId || !proofImage) {
    return res.status(400).json({ error: 'Transaction ID and Payment Proof (image) are required.' });
  }

  try {
    const [dRows] = await db.query('SELECT pickup_id FROM donations WHERE id = ?', [donationId]);
    if (dRows[0] && dRows[0].pickup_id) {
      const pickupId = dRows[0].pickup_id;
      await db.execute('UPDATE pickups SET vendor_confirmed = 1 WHERE id = ?', [pickupId]);

      // Record transaction for vendor (Outflow to NGO)
      const [pDetails] = await db.query('SELECT vendor_id, final_amount, total_bill FROM pickups WHERE id = ?', [pickupId]);
      if (pDetails[0] && pDetails[0].vendor_id) {
        const amount = pDetails[0].total_bill || 0;
        await db.execute(
          'INSERT INTO transactions (wallet_id, type, entity, entity_id, amount, description) VALUES ((SELECT id FROM wallets WHERE user_id = ?), "debit", "donation", ?, ?, ?)',
          [pDetails[0].vendor_id, pickupId, amount, `Direct donation payout to NGO for order #${pickupId}`]
        );
      }

      // Check if dual confirmation is complete (vendor confirming payment is one step)
      const [pRows] = await db.execute('SELECT customer_confirmed FROM pickups WHERE id = ?', [pickupId]);
      if (pRows[0] && pRows[0].customer_confirmed) {
        await db.execute('UPDATE pickups SET payment_status = "paid" WHERE id = ?', [pickupId]);
      }

      // AUTO-GENERATE CERTIFICATE
      try {
        await exports.generateCertificate({ params: { donationId } }, { json: () => { }, status: () => ({ json: () => { } }), headersSent: true });
      } catch (certErr) {
        console.error('Auto-Cert Error (Manual):', certErr.message);
      }

    }

    await db.execute(
      'UPDATE donations SET status = "paid", paid_at = CURRENT_TIMESTAMP, transaction_id = ?, proof_image = ? WHERE id = ?',
      [transactionId, proofImage, donationId]
    );

    res.json({ success: true, message: 'Donation reported! Waiting for Admin verification.' });
  } catch (err) {
    console.error('❌ MARK DONATION PAID ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

// Admin: Get donations pending verification
exports.getPendingDonations = async (req, res) => {
  try {
    const [donations] = await db.query(`
      SELECT d.*, 
        u.phone as customer_phone, 
        COALESCE(v.business_name, 'Unknown Vendor') as vendor_name,
        vu.phone as vendor_phone,
        COALESCE(n.name, 'Unassigned') as ngo_name,
        n.upi_id as ngo_upi
      FROM donations d
      JOIN users u ON d.user_id = u.id
      LEFT JOIN vendors v ON d.vendor_id = v.user_id
      LEFT JOIN users vu ON d.vendor_id = vu.id
      LEFT JOIN ngos n ON d.ngo_id = n.id
      WHERE (d.status = 'paid' OR d.proof_image IS NOT NULL)
        AND (d.is_approved = 0 OR d.is_approved IS NULL)
      ORDER BY d.created_at DESC
    `);

    res.json(donations);
  } catch (err) {
    console.error('getPendingDonations error:', err);
    res.status(500).json({ error: err.message });
  }
};

// Admin: Approve donation and generate certificate
exports.approveDonation = async (req, res) => {
  const { donationId } = req.params;
  try {
    await db.execute(
      'UPDATE donations SET is_approved = 1, approved_at = CURRENT_TIMESTAMP WHERE id = ?',
      [donationId]
    );

    // After approval, automatically generate certificate
    // This function will also send the WhatsApp message
    return exports.generateCertificate({ params: { donationId } }, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const db = require('../config/db');
const whatsapp = require('../utils/whatsappService');
const pushService = require('../utils/pushService');
const { createNotification } = require('./notificationController');

exports.completePickup = async (req, res) => {
  const { pickupId, finalItems } = req.body;
  if (!pickupId || !finalItems || finalItems.length === 0) {
    return res.status(400).json({ error: 'pickupId and finalItems are required' });
  }

  try {
    let totalBill = 0;
    const billBreakdown = [];

    for (const item of finalItems) {
      const [rateRow] = await db.query('SELECT rate, name FROM scrap_items WHERE id = ?', [item.id]);
      if (!rateRow[0]) continue;
      const currentRate = parseFloat(rateRow[0].rate);
      const weight = parseFloat(item.weight) || 0;
      const amount = currentRate * weight;
      totalBill += amount;
      billBreakdown.push({ name: rateRow[0].name, weight, rate: currentRate, amount });

      await db.execute(`
        INSERT INTO pickup_items (pickup_id, scrap_item_id, actual_weight, rate_at_collection)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE actual_weight = VALUES(actual_weight), rate_at_collection = VALUES(rate_at_collection)
      `, [pickupId, item.id, weight, currentRate]);
    }

    // Finalize pickup
    await db.execute(
      'UPDATE pickups SET status = ?, total_bill = ?, final_amount = ? WHERE id = ?',
      ['completed', totalBill, totalBill, pickupId]
    );

    // Track Payments in Wallets Ledger
    try {
      const walletController = require('./walletController');
      const [pRows] = await db.query(
        'SELECT p.*, u.phone, u.push_token, u.id as customer_id FROM pickups p JOIN users u ON p.user_id = u.id WHERE p.id = ?',
        [pickupId]
      );
      const pickup = pRows[0];
      if (pickup) {
        // Support donation override from request
        const { isDonation } = req.body;
        if (isDonation) {
          await db.execute('UPDATE pickups SET type = ? WHERE id = ?', ['donate', pickupId]);
          pickup.type = 'donate';
        }

        let isDonate = pickup.type === 'donate';
        
        if (isDonate) {
          // Vendor collected scrap for free, owes value to admin/NGO via donation
          if (pickup.vendor_id) {
             await walletController.addTransaction(pickup.vendor_id, 'debit', 'donation', pickupId, totalBill, `Donation transfer to NGO/Admin for pickup #${pickupId}`);
          }
        } else {
          // Standard sell: Customer earns money, Vendor pays money 
          if (pickup.vendor_id) {
            await walletController.addTransaction(pickup.vendor_id, 'debit', 'pickup', pickupId, totalBill, `Paid customer for scrap pickup #${pickupId}`);
          }
          await walletController.addTransaction(pickup.customer_id, 'credit', 'pickup', pickupId, totalBill, `Payout received for scrap pickup #${pickupId}`);
        }

        const breakdown = billBreakdown
          .map(b => `  • ${b.name}: ${b.weight}kg` + (isDonate ? '' : ` × ₹${b.rate} = ₹${b.amount.toFixed(2)}`))
          .join('\n');

        if (isDonate) {
          try {
            const PDFDocument = require('pdfkit');
            const fs = require('fs');
            const path = require('path');
            const doc = new PDFDocument({ size: 'A4', margin: 50 });
            
            // Ensure uploads directory exists
            const uploadDir = path.join(__dirname, '..', 'uploads');
            if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
            
            const certPath = path.join(uploadDir, `certificate_${pickupId}.pdf`);
            const writeStream = fs.createWriteStream(certPath);
            doc.pipe(writeStream);
            
            // --- Premium Certificate Design ---
            const logoPath = path.join(__dirname, '..', 'assets', 'logo.png');
            const signaturePath = path.join(__dirname, '..', 'assets', 'signature.png');

            // Background Border
            doc.rect(20, 20, 555, 782).lineWidth(2).strokeColor('#10b981').stroke();
            doc.rect(25, 25, 545, 772).lineWidth(0.5).strokeColor('#10b981').stroke();

            // Logo
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
            
            // Unique ID (Mobile Number)
            doc.fontSize(28).fillColor('#10b981').text(`+91 ${pickup.phone}`, { align: 'center', underline: true });
            doc.moveDown(1.5);

            doc.fontSize(15).fillColor('#374151').text(
              `For their generous contribution of scrap materials valued at Rs. ${totalBill.toFixed(2)}. Your commitment to recycling helps us build a cleaner, greener India and supports our NGO partners in their noble cause.`,
              { align: 'center', width: 450, indent: 0, lineGap: 5 }
            );

            doc.moveDown(3);

            // Itemized Summary
            doc.fontSize(12).fillColor('#6B7280').text('CONTRIBUTION DETAILS:', { align: 'center' });
            doc.moveDown(0.5);
            billBreakdown.forEach(item => {
              doc.fontSize(11).fillColor('#4B5563').text(`${item.name}: ${item.weight} kg`, { align: 'center' });
            });

            doc.moveDown(3);

            // Signature & Date
            const bottomY = doc.y;
            
            // Date on left
            doc.fontSize(12).fillColor('#111827').text(`Date: ${new Date().toLocaleDateString()}`, 100, bottomY + 40);
            doc.text('____________________', 100, bottomY + 45);
            doc.fontSize(10).fillColor('#9ca3af').text('Issued Date', 100, bottomY + 60);

            // Signature on right
            if (fs.existsSync(signaturePath)) {
              doc.image(signaturePath, 380, bottomY, { width: 120 });
            }
            doc.fontSize(12).fillColor('#111827').text('____________________', 380, bottomY + 45);
            doc.fontSize(10).fillColor('#111827').text('Founder, ChandKabadiWala', 380, bottomY + 60);

            doc.moveDown(4);
            doc.fontSize(10).fillColor('#9ca3af').text(`Certificate ID: CKW-DONATE-${pickupId}`, { align: 'center' });
            
            doc.end();

            await new Promise(resolve => writeStream.on('finish', resolve));

            const msg = `🌟 *Thank You for Donating!*\n\nYour donated items have been collected.\n${breakdown}\n\nWe have generated your formal Donation Certificate. Please find it attached.\nThanks to your contribution, materials valued at ₹${totalBill.toFixed(2)} have been directed towards social good! 💚`;
            await whatsapp.sendDocument(pickup.phone, certPath, `Donation_Certificate_${pickupId}.pdf`, msg);

            if (pickup.push_token) {
              pushService.sendPushNotification(
                pickup.push_token,
                '🌟 Thank You!',
                `Donation collected! Valuation: ₹${totalBill.toFixed(2)}.`,
                { pickupId }
              );
            }

            await createNotification(
              pickup.user_id,
              '🌟 Donation Successful',
              `Your donation was collected. Valuation: ₹${totalBill.toFixed(2)}. View certificate in WhatsApp.`,
              'billing',
              pickupId
            );
          } catch(e) {
            console.error('Donation certificate generation logic failed', e);
          }
        } else {
          // Standard Sell Flow
          await whatsapp.sendMessage(pickup.phone,
            `✅ *Pickup Completed!*\n\nOrder #${pickupId} has been collected.\n\n*Bill Summary:*\n${breakdown}\n\n💰 *Total: ₹${totalBill.toFixed(2)}*\n\nThank you for using ChandKabadiWala! ♻️`
          );

          if (pickup.push_token) {
            pushService.sendPushNotification(
              pickup.push_token,
              '✅ Pickup Complete!',
              `Your scrap was collected. Total: ₹${totalBill.toFixed(2)}`,
              { pickupId }
            );
          }

          // Save in-app notification
          await createNotification(
            pickup.user_id,
            '✅ Pickup Completed',
            `Your order #${pickupId} was successfully collected. Total payout: ₹${totalBill.toFixed(2)}.`,
            'billing',
            pickupId
          );
        }
      }
    } catch (notifErr) {
      console.error('Completion notification failed:', notifErr.message);
    }

    console.log(`💰 BILL GENERATED: Pickup #${pickupId} = ₹${totalBill}`);
    res.json({ success: true, totalBill, billBreakdown, message: 'Pickup completed and bill generated!' });

  } catch (err) {
    console.error('❌ Billing Error:', err);
    res.status(500).json({ error: 'Failed to complete transaction' });
  }
};

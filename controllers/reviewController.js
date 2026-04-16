const db = require('../config/db');

exports.submitReview = async (req, res) => {
  const { pickupId, vendorId, rating, comment } = req.body;
  const customerId = req.user.id; 

  try {
    await db.execute(`
      INSERT INTO reviews (pickup_id, customer_id, vendor_id, rating, comment)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE rating = VALUES(rating), comment = VALUES(comment)
    `, [pickupId, customerId, vendorId, rating, comment]);

    res.json({ success: true, message: 'Review saved successfully' });
  } catch (err) {
    console.error('Submit review error:', err);
    res.status(500).json({ error: 'Failed to save review' });
  }
};

exports.getVendorReviews = async (req, res) => {
  const { vendorId } = req.params;
  try {
    const [reviews] = await db.execute(`
      SELECT r.*, u.phone as customer_phone 
      FROM reviews r 
      JOIN users u ON r.customer_id = u.id 
      WHERE r.vendor_id = ?
      ORDER BY r.created_at DESC
    `, [vendorId]);

    const [avg] = await db.execute('SELECT AVG(rating) as average_rating FROM reviews WHERE vendor_id = ?', [vendorId]);
    
    res.json({ 
      success: true, 
      reviews, 
      averageRating: avg[0].average_rating || 0 
    });
  } catch (err) {
    console.error('Get reviews error:', err);
    res.status(500).json({ error: 'Failed to get reviews' });
  }
};

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const auth = require('../middleware/authMiddleware');

// /api/payments/subscribe
router.post('/subscribe', auth(), paymentController.createSubscriptionOrder);
router.post('/subscribe/verify', auth(), paymentController.verifySubscriptionPayment);

router.post('/donation', auth(), paymentController.createDonationOrder);
router.post('/donation/verify', auth(), paymentController.verifyDonationPayment);
router.post('/donation/bulk-settle', auth(), paymentController.createBulkDonationOrder);
router.post('/donation/verify-bulk', auth(), paymentController.verifyBulkDonationPayment);

module.exports = router;

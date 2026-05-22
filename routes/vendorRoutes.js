const express = require('express');
const router = express.Router();
const vendorController = require('../controllers/vendorController');
const auth = require('../middleware/authMiddleware');
const subscriptionAuth = require('../middleware/subscriptionMiddleware');

// All vendor routes require authentication and active subscription
router.use(auth(['vendor']));
router.use(subscriptionAuth);

// Business Center & Certifications
router.get('/business-preview', vendorController.getBusinessPreview);
router.post('/donate', vendorController.processDonation);
router.get('/wallet', vendorController.getVendorWallet);
router.post('/check-availability', vendorController.checkAvailability);

module.exports = router;

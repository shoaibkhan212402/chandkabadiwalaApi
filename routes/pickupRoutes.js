const express = require('express');
const router = express.Router();
const pickupController = require('../controllers/pickupController');
const billingController = require('../controllers/billingController');
const auth = require('../middleware/authMiddleware');
const subscriptionAuth = require('../middleware/subscriptionMiddleware');

// @route   POST /api/pickups
// @desc    Create new pickup request
router.post('/', auth(), pickupController.createPickup);

// @route   GET /api/pickups/available
// @desc    Get all pending pickups (for Vendors)
router.get('/available', auth(), pickupController.getAvailablePickups);

// @route   GET /api/pickups/vendor/my
// @desc    Get logged in vendor's assigned pickups
router.get('/vendor/my', auth(), pickupController.getVendorPickups);

// @route   GET /api/pickups/vendor/:vendorId
// @desc    Get all pickups for a specific vendor
router.get('/vendor/:vendorId', auth(), pickupController.getVendorPickups);

// @route   GET /api/pickups/id/:pickupId
// @desc    Get single pickup detail with items
router.get('/id/:pickupId', auth(), pickupController.getPickupById);

// @route   POST /api/pickups/claim
// @desc    Vendor claims a pickup
router.post('/claim', auth(['vendor']), subscriptionAuth, pickupController.claimPickup);

// @route   PATCH /api/pickups/status
// @desc    Update status (Arrival, Completion)
router.patch('/status', auth(), pickupController.updateStatus);

// @route   PATCH /api/pickups/location
// @desc    Update vendor location natively
router.patch('/location', auth(), pickupController.updateLocation);

// @route   POST /api/pickups/complete
// @desc    Finalize transaction and build bill (DEPRECATED: use /finalize-billing)
router.post('/complete', auth(['vendor']), billingController.completePickup);

// @route   POST /api/pickups/finalize-billing
// @desc    Vendor enters actual weights and generates bill
router.post('/finalize-billing', auth(['vendor']), pickupController.finalizeBilling);

// @route   POST /api/pickups/ensure-donation
// @desc    Recovery endpoint to create missing donation record
router.post('/ensure-donation', auth(['vendor']), pickupController.ensureDonation);

// @route   POST /api/pickups/convert-to-donation
// @desc    Customer chooses to donate the finalized bill amount instead of taking cash
router.post('/convert-to-donation', auth(['customer']), pickupController.convertPickupToDonation);

// @route   POST /api/pickups/confirm-payment
// @desc    Both parties confirm payment
router.post('/confirm-payment', auth(), pickupController.confirmPayment);

// @route   GET /api/pickups/customer/my
// @desc    Get logged in user's pickups
router.get('/customer/my', auth(), pickupController.getUserPickups);

module.exports = router;

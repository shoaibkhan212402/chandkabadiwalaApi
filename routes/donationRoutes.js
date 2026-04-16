const express = require('express');
const router = express.Router();
const donationController = require('../controllers/donationController');
const auth = require('../middleware/authMiddleware');

// ⚠️ IMPORTANT: Static routes MUST come before dynamic /:donationId routes

// @route   POST /api/donations
// @desc    Create a new donation record
router.post('/', auth(), donationController.createDonation);

// @route   GET /api/donations/my
// @desc    Get user's donation history
router.get('/my', auth(), donationController.getUserDonations);

// @route   GET /api/donations/all
// @desc    Admin: Get all donations with stats
router.get('/all', auth(['admin']), donationController.getAllDonations);

// @route   GET /api/donations/pending-verification
// @desc    Admin: Get donations waiting for proof verification
router.get('/pending-verification', auth(['admin']), donationController.getPendingDonations);

// @route   GET /api/donations/:donationId
// @desc    Get single donation detail (MUST be after static routes)
router.get('/:donationId', auth(), donationController.getDonationById);

// @route   POST /api/donations/:donationId/certificate
// @desc    Generate and send donation certificate
router.post('/:donationId/certificate', auth(), donationController.generateCertificate);

// @route   PATCH /api/donations/:donationId/paid
// @desc    Vendor marks donation as paid to NGO (with proof)
router.patch('/:donationId/paid', auth(['vendor']), donationController.markDonationPaid);

// @route   POST /api/donations/:donationId/approve
// @desc    Admin: Verify proof and approve donation (triggers certificate generation)
router.post('/:donationId/approve', auth(['admin']), donationController.approveDonation);

module.exports = router;

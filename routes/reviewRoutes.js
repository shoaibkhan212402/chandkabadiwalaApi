const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/reviewController');
const auth = require('../middleware/authMiddleware');

// @route   POST /api/reviews
// @desc    Submit a new review
router.post('/', auth(), reviewController.submitReview);

// @route   GET /api/reviews/vendor/:vendorId
// @desc    Get all reviews for a specific vendor
router.get('/vendor/:vendorId', reviewController.getVendorReviews);

module.exports = router;

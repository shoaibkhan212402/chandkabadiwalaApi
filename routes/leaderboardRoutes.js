const express = require('express');
const router = express.Router();
const leaderboardController = require('../controllers/leaderboardController');
const auth = require('../middleware/authMiddleware');

// @route   GET /api/leaderboard/vendors
// @desc    Get top 10 performing vendors
router.get('/vendors', leaderboardController.getVendorLeaderboard);

// @route   GET /api/leaderboard/donors
// @desc    Get top 10 highest value donors
router.get('/donors', leaderboardController.getDonorLeaderboard);

module.exports = router;

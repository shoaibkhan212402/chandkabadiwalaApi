const express = require('express');
const router = express.Router();
const smartPricingController = require('../controllers/smartPricingController');
const auth = require('../middleware/authMiddleware');

// @route   GET /api/smart-pricing/suggestions
// @desc    Get dynamic AI market price trend recommendations
router.get('/suggestions', auth(['admin']), smartPricingController.getDynamicSuggestions);

module.exports = router;

const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const auth = require('../middleware/authMiddleware');

// Get wallet details for logged in user
router.get('/my', auth(), walletController.getWalletDetails);
router.get('/me', auth(), walletController.getWalletDetails); // alias for mobile app

// Get all wallets for Admin
router.get('/all', auth(), walletController.getAllWallets);

module.exports = router;

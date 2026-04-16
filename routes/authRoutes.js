const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const auth = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// 🛡️ Security: OTP Spam Protection (Max 3 OTP requests every 10 minutes per IP)
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, 
  max: 3, 
  message: { error: 'Too many OTP requests from this IP, please try again after 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// @route   POST /api/auth/send-otp
// @desc    Send OTP via WhatsApp (secured strictly with Rate Limiter)
router.post('/send-otp', otpLimiter, authController.sendOTP);

// @route   POST /api/auth/verify-otp
// @desc    Verify OTP and return JWT
router.post('/verify-otp', authController.verifyOTP);

// @route   POST /api/auth/register-vendor
// @desc    Vendor sign-up journey
router.post('/register-vendor', authController.registerVendor);

// @route   POST /api/auth/admin-login
// @desc    Admin panel login
router.post('/admin-login', authController.adminLogin);

// @route   POST /api/auth/update-push-token
// @desc    Update device exponent push token
router.post('/update-push-token', auth(), authController.updatePushToken);

// @route   GET /api/auth/me
// @desc    Get complete user profile and stats
router.get('/me', auth(), authController.getProfile);

// @route   PUT /api/auth/profile
// @desc    Update basic user profile details (name, address)
router.put('/profile', auth(), authController.updateProfile);

// @route   DELETE /api/auth/delete-account
// @desc    Permanently delete user's account and associated data (App Store Requirement)
router.delete('/delete-account', auth(), authController.deleteAccount);

module.exports = router;

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const auth = require('../middleware/authMiddleware');

// 🔐 ALL admin routes are protected — require valid admin JWT
router.use(auth(['admin']));

// @route   GET /api/admin/pending-vendors
// @desc    List vendors for verification
router.get('/pending-vendors', adminController.getPendingVendors);

// @route   GET /api/admin/vendors
// @desc    List all vendors with status sorting
router.get('/vendors', adminController.getAllVendors);

// @route   POST /api/admin/verify-vendor
// @desc    Verify vendor status
router.post('/verify-vendor', adminController.verifyVendor);

// @route   DELETE /api/admin/vendor/:userId
// @desc    Delete a vendor record
router.delete('/vendor/:userId', adminController.deleteVendor);

// @route   GET /api/admin/users
// @desc    List all users
router.get('/users', adminController.getAllUsers);

// @route   GET /api/admin/*-reports
// @desc    Financial & logistics reporting ledgers
router.get('/renewal-reports', adminController.getRenewalReports);
router.get('/donation-reports', adminController.getDonationReports);
router.get('/pickup-reports', adminController.getPickupReports);



// @route   POST /api/admin/toggle-user-status
// @desc    Suspend or reactivate any user/vendor account
router.post('/toggle-user-status', adminController.toggleUserStatus);

// @route   GET /api/admin/stats
// @desc    Get dashboard metrics
router.get('/stats', adminController.getStats);

// @route   GET /api/admin/whatsapp-status
// @desc    Get whatsapp qr code and status
router.get('/whatsapp-status', adminController.getWhatsappStatus);

// @route   GET /api/admin/analytics
// @desc    Get advanced data analytics
router.get('/analytics', adminController.getAnalytics);

// @route   GET /api/admin/pickups
// @desc    Get all active/completed pickups
router.get('/pickups', adminController.getAllPickups);

// @route   GET /api/admin/activity
// @desc    Get system global activity log
router.get('/activity', adminController.getActivityLog);

// @route   POST /api/admin/whatsapp-logout
// @desc    Logout from whatsapp
router.post('/whatsapp-logout', adminController.logoutWhatsApp);

// @route   POST /api/admin/whatsapp-reconnect
// @desc    Reconnect/Refresh whatsapp session
router.post('/whatsapp-reconnect', adminController.reconnectWhatsApp);

// @route   POST /api/admin/whatsapp-reset
// @desc    Hard reset/Clear whatsapp session
router.post('/whatsapp-reset', adminController.resetWhatsApp);

// @route   GET /api/admin/export/:type
// @desc    Export specific dataset as CSV
router.get('/export/:type', adminController.exportData);
// @route   POST /api/admin/notifications/broadcast
// @desc    Broadcast push notifications to targeted devices
router.post('/notifications/broadcast', adminController.broadcastNotification);

module.exports = router;

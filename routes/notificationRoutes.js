const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const ctrl = require('../controllers/notificationController');

router.get('/', auth(), ctrl.getNotifications);
router.patch('/read-all', auth(), ctrl.markAllRead);
router.patch('/:id/read', auth(), ctrl.markRead);

module.exports = router;

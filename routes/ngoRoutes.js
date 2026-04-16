const express = require('express');
const router = express.Router();
const ngoController = require('../controllers/ngoController');
const auth = require('../middleware/authMiddleware');

router.get('/', ngoController.getAllNGOs);
router.get('/:id', ngoController.getNGOById);

// Admin only
router.post('/', auth(['admin']), ngoController.createNGO);
router.put('/:id', auth(['admin']), ngoController.updateNGO);
router.delete('/:id', auth(['admin']), ngoController.deleteNGO);

module.exports = router;

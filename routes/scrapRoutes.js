const express = require('express');
const router = express.Router();
const scrapController = require('../controllers/scrapController');

// @route   GET /api/scraps
// @desc    Get all scrap categories and rates
router.get('/', scrapController.getAllRates);

// @route   GET /api/scraps/search
// @desc    Search categories and items
router.get('/search', scrapController.searchScrap);

// @route   POST /api/scraps/category
// @desc    Add new category
router.post('/category', scrapController.addCategory);

// @route   PUT /api/scraps/category/:id
// @desc    Edit existing category
router.put('/category/:id', scrapController.editCategory);

// @route   POST /api/scraps/item
// @desc    Add new scrap item
router.post('/item', scrapController.addScrapItem);

// @route   PUT /api/scraps/item/:id
// @desc    Edit existing item
router.put('/item/:id', scrapController.editScrapItem);

// @route   PATCH /api/scraps/item/:id/rate
// @desc    Update only item rate
router.patch('/item/:id/rate', scrapController.patchScrapItemRate);

// @route   DELETE /api/scraps/category/:id
// @desc    Delete category
router.delete('/category/:id', scrapController.deleteCategory);

// @route   DELETE /api/scraps/item/:id
// @desc    Delete item
router.delete('/item/:id', scrapController.deleteScrapItem);

module.exports = router;

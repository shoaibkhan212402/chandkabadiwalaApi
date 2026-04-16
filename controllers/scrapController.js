const Category = require('../models/categoryModel');
const ScrapItem = require('../models/scrapItemModel');
const redisClient = require('../config/redis');

// Utility to clear all scrap-related cached data upon price/items modification
const clearScrapCache = async () => {
  try {
    const keys = await redisClient.keys('scraps:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
    }
  } catch (err) {
    console.error('Failed to clear scrap cache:', err);
  }
};

exports.getAllRates = async (req, res) => {
  try {
    const { categoryId } = req.query;
    
    if (categoryId) {
      const cacheKey = `scraps:cat:${categoryId}`;
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));

      const items = await ScrapItem.findByCategoryId(categoryId);
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(items));
      return res.json(items);
    }
    
    const cacheKeyAll = 'scraps:all';
    const cachedAll = await redisClient.get(cacheKeyAll);
    if (cachedAll) return res.json(JSON.parse(cachedAll));

    const categories = await Category.findAll();
    const result = await Promise.all(categories.map(async (cat) => {
      const items = await ScrapItem.findByCategoryId(cat.id);
      return { ...cat, items };
    }));
    
    await redisClient.setEx(cacheKeyAll, 3600, JSON.stringify(result));
    res.json(result);
  } catch (error) {
    console.error('❌ Error fetching rates:', error);
    res.status(500).json({ error: 'Server Error' });
  }
};

exports.addCategory = async (req, res) => {
  try {
    const { name, icon, description } = req.body;
    const id = await Category.create(name, icon, description);
    await clearScrapCache();
    res.status(201).json({ id, name, icon, message: 'Category added!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.addScrapItem = async (req, res) => {
  try {
    const { categoryId, name, rate, unit, image } = req.body;
    const id = await ScrapItem.create(categoryId, name, rate, unit, image);
    await clearScrapCache();
    res.status(201).json({ id, name, rate, unit, image, message: 'Item added!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.editCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, icon, description } = req.body;
    await Category.update(id, name, icon, description);
    await clearScrapCache();
    res.status(200).json({ message: 'Category modified successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.editScrapItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { categoryId, name, rate, unit, image } = req.body;
    await ScrapItem.update(id, categoryId, name, rate, unit, image);
    await clearScrapCache();
    res.status(200).json({ message: 'Item modified successfully!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.searchScrap = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json({ categories: [], items: [] });
    
    const [categories, items] = await Promise.all([
      Category.search(q),
      ScrapItem.search(q)
    ]);
    
    res.json({ categories, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category has items
    const db = require('../config/db');
    const [items] = await db.query('SELECT id FROM scrap_items WHERE category_id = ?', [id]);
    if (items.length > 0) {
      const itemIds = items.map(i => i.id);
      // Null out FK references in pickup_items history first
      await db.query(
        `UPDATE pickup_items SET scrap_item_id = NULL WHERE scrap_item_id IN (${itemIds.map(() => '?').join(',')})`,
        itemIds
      );
      // Now delete all items in this category
      await db.query('DELETE FROM scrap_items WHERE category_id = ?', [id]);
    }

    await Category.delete(id);
    await clearScrapCache();
    res.json({ message: 'Category and all its items deleted successfully!' });
  } catch (error) {
    console.error('Delete Category Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.deleteScrapItem = async (req, res) => {
  try {
    const { id } = req.params;
    const db = require('../config/db');

    // Preserve billing history: null out the FK reference, keep the item_name (already stored)
    await db.execute('UPDATE pickup_items SET scrap_item_id = NULL WHERE scrap_item_id = ?', [id]);

    await ScrapItem.delete(id);
    await clearScrapCache();
    res.json({ message: 'Item deleted successfully!' });
  } catch (error) {
    console.error('Delete Scrap Item Error:', error);
    res.status(500).json({ error: error.message });
  }
};

exports.patchScrapItemRate = async (req, res) => {
  try {
    const { id } = req.params;
    const { rate } = req.body;
    await ScrapItem.updateRate(id, rate);
    await clearScrapCache();
    res.json({ message: 'Rate updated!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

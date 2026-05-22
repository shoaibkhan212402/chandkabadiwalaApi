const db = require('../config/db');
const redisClient = require('../config/redis');

async function migrate() {
  console.log('🔄 Running database migration for scrap prices and images...');
  try {
    // 1. Update Corrugated Box / Gatta (Carton, id: 3)
    await db.execute(
      'UPDATE scrap_items SET name = ?, rate = ?, image = ? WHERE id = ?',
      ['Corrugated Box / Gatta', 9.00, 'https://chandkabadiwala.com/images/corrugated_box.png', 3]
    );
    console.log('✅ Updated Carton -> Corrugated Box / Gatta (id 3)');

    // 2. Update Books / Copies (Books, id: 4)
    await db.execute(
      'UPDATE scrap_items SET name = ?, rate = ?, image = ? WHERE id = ?',
      ['Books / Copies', 14.00, 'https://chandkabadiwala.com/images/books_copies.png', 4]
    );
    console.log('✅ Updated Books -> Books / Copies (id 4)');

    // 3. Update A3/A4 Paper (Record Paper, id: 7)
    await db.execute(
      'UPDATE scrap_items SET name = ?, rate = ?, image = ? WHERE id = ?',
      ['A3/A4 Paper', 14.50, 'https://chandkabadiwala.com/images/a3_a4_paper.png', 7]
    );
    console.log('✅ Updated Record Paper -> A3/A4 Paper (id 7)');

    // 4. Update News Paper (Newspaper, id: 2)
    await db.execute(
      'UPDATE scrap_items SET name = ?, rate = ?, image = ? WHERE id = ?',
      ['News Paper', 14.50, 'https://chandkabadiwala.com/images/newspaper.png', 2]
    );
    console.log('✅ Updated Newspaper -> News Paper (id 2)');

    // 5. Safely handle/delete Copy (id: 8) to avoid double books/copies entry
    await db.execute('UPDATE pickup_items SET scrap_item_id = NULL WHERE scrap_item_id = 8');
    await db.execute('DELETE FROM scrap_items WHERE id = 8');
    console.log('✅ Consolidated Copy (id 8) and cleaned up references');

    // 6. Clear Redis scraps cache
    const keys = await redisClient.keys('scraps:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`✅ Cleared ${keys.length} cached scraps keys in Redis`);
    } else {
      console.log('ℹ️ No cached scraps keys in Redis');
    }

    console.log('🎉 DB Migration finished successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();

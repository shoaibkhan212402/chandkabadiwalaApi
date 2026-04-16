const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
};

async function resetDB() {
  const connection = await mysql.createConnection(dbConfig);
  console.log('📦 Connected to DB for reset...');

  try {
    // Disable foreign key checks for clean truncation
    await connection.execute('SET FOREIGN_KEY_CHECKS = 0');

    console.log('🗑️  Clearing Pickups & Related Data...');
    await connection.execute('TRUNCATE TABLE pickup_images');
    await connection.execute('TRUNCATE TABLE pickup_items');
    await connection.execute('TRUNCATE TABLE pickups');

    console.log('🗑️  Clearing Financial Data...');
    await connection.execute('TRUNCATE TABLE transactions');
    await connection.execute('TRUNCATE TABLE wallets');
    await connection.execute('TRUNCATE TABLE donations');

    console.log('🗑️  Clearing Social & Support Data...');
    await connection.execute('TRUNCATE TABLE reviews');
    await connection.execute('TRUNCATE TABLE notifications');
    await connection.execute('TRUNCATE TABLE support_tickets');

    console.log('🗑️  Clearing Vendor Profiles...');
    await connection.execute('TRUNCATE TABLE vendors');

    console.log('🗑️  Clearing WhatsApp Auth Data...');
    await connection.execute('TRUNCATE TABLE whatsapp_auth');

    console.log('👤 Clearing Non-Admin Users...');
    // We don't truncate users because we need to keep admins
    // First, find admin IDs to avoid accidental deletion
    const [admins] = await connection.query('SELECT id FROM users WHERE role = "admin"');
    const adminIds = admins.map(a => a.id);
    
    if (adminIds.length > 0) {
       await connection.query('DELETE FROM users WHERE role != "admin"');
       console.log(`✅ Cleared all users except ${adminIds.length} admins.`);
    } else {
       console.log('⚠️ No admin found. Clearing all users...');
       await connection.execute('TRUNCATE TABLE users');
    }

    // Re-enable foreign key checks
    await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✨ Database reset complete! Inventory (Scrap Items) and Admin accounts were PRESERVED.');

  } catch (err) {
    console.error('❌ Reset Failed:', err.message);
  } finally {
    await connection.end();
    process.exit();
  }
}

resetDB();

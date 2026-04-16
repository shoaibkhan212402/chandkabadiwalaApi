const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const deepClean = async () => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
        });

        console.log('🔄 Connected to database. Starting deep clean...');

        await connection.execute('SET FOREIGN_KEY_CHECKS = 0');

        // Tables to TRUNCATE (Wipe all data)
        const tablesToWipe = [
            'users',
            'vendors',
            'pickups',
            'pickup_items',
            'pickup_images',
            'notifications',
            'admins',
            'reviews',
            'whatsapp_auth',
            'donations',
            'wallets',
            'transactions',
            'support_tickets',
            'ngos'
        ];

        for (const table of tablesToWipe) {
            try {
                await connection.execute(`TRUNCATE TABLE ${table}`);
                console.log(`  ✅ Wiped table: ${table}`);
            } catch (err) {
                console.warn(`  ⚠️ Could not truncate ${table}: ${err.message}`);
            }
        }

        await connection.execute('SET FOREIGN_KEY_CHECKS = 1');

        console.log('🏗️ Recreating Admin Account...');
        const adminEmail = process.env.INITIAL_ADMIN_EMAIL || 'admin@chandkabadi.com';
        const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || 'admin123';
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(adminPassword, salt);

        await connection.execute(
            'INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, ?)',
            ['Super Admin', adminEmail, hashedPassword, 'admin']
        );
        console.log(`  ✅ Admin created: ${adminEmail} (password: ${adminPassword})`);

        console.log('🏗️ Seeding Default NGO...');
        await connection.execute(
            'INSERT INTO ngos (name, description, upi_id) VALUES (?, ?, ?)',
            ['Helping Hand NGO', 'Default community partner for scrap donations', 'chandkabadiwala@ybl']
        );
        console.log('  ✅ Default NGO seeded.');

        console.log('\n✨ Deep clean and reset complete! Inventory data (categories & scrap_items) was preserved.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Error during deep clean:', err);
        process.exit(1);
    } finally {
        if (connection) await connection.end();
    }
};

deepClean();

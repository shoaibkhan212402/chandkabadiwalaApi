const db = require("./db");
const { env, optionalEnv } = require("./env");
const pino = require("pino");
const bcrypt = require("bcryptjs");

const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  timestamp: pino.stdTimeFunctions.isoTime,
});

const safeAddColumn = async (table, column, definition) => {
  try {
    await db.execute(
      `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
    );
    console.log(`  ✅ Added ${table}.${column}`);
  } catch (e) {
    if (e.code === "ER_DUP_FIELDNAME") {
      /* column already exists */
    } else console.error(`  ⚠️ Migration ${table}.${column}:`, e.message);
  }
};

const initDB = async () => {
  try {
    console.log("🔄 Attempting to connect to database...");
    console.log("📄 Config:", {
      host: env.dbHost,
      user: env.dbUser,
      database: env.dbName,
    });

    const [rows] = await db.query("SELECT 1 + 1 AS result");
    console.log(
      "✅ Database connection test successful,  Result:",
      rows[0].result,
    );

    // Create Users table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        phone VARCHAR(15) UNIQUE NOT NULL,
        role ENUM('admin', 'vendor', 'customer') DEFAULT 'customer',
        status ENUM('active', 'pending', 'inactive') DEFAULT 'active',
        push_token VARCHAR(255),
        subscription_active TINYINT(1) DEFAULT 0,
        subscription_expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Vendors table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS vendors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNIQUE,
        business_name VARCHAR(255),
        address TEXT,
        lat DECIMAL(10, 8),
        lng DECIMAL(11, 8),
        aadhar_front VARCHAR(255),
        aadhar_back VARCHAR(255),
        pan_front VARCHAR(255),
        pan_back VARCHAR(255),
        shop_photo VARCHAR(255),
        bank_name VARCHAR(255),
        account_number VARCHAR(100),
        ifsc_code VARCHAR(50),
        upi_id VARCHAR(255),
        designation VARCHAR(255),
        pincode VARCHAR(10),
        status ENUM('pending', 'active', 'inactive') DEFAULT 'pending',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create Categories table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        icon VARCHAR(255),
        description TEXT
      )
    `);

    // Create Scrap Items table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS scrap_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT,
        name VARCHAR(255) NOT NULL,
        rate DECIMAL(10, 2) NOT NULL,
        unit VARCHAR(50),
        image VARCHAR(255),
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);

    // Create Pickups table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS pickups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        vendor_id INT,
        address TEXT,
        pickup_date DATE,
        time_slot VARCHAR(50),
        type ENUM('sell', 'donate') DEFAULT 'sell',
        status ENUM('pending', 'assigned', 'accepted', 'arriving', 'on_the_way', 'reached', 'started', 'completed', 'cancelled') DEFAULT 'pending',
        total_bill DECIMAL(15, 2) DEFAULT 0.00,
        final_amount DECIMAL(15, 2) DEFAULT 0.00,
        customer_lat DECIMAL(10, 8),
        customer_lng DECIMAL(11, 8),
        vendor_lat DECIMAL(10, 8),
        vendor_lng DECIMAL(11, 8),
        estimated_weight_range VARCHAR(50),
        vehicle_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (vendor_id) REFERENCES users(id)
      )
    `);

    // Create Notifications table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        title VARCHAR(255),
        message TEXT,
        type VARCHAR(50),
        payload TEXT,
        is_read TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create Pickup Items table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS pickup_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pickup_id INT,
        scrap_item_id INT,
        item_name VARCHAR(255),
        weight DECIMAL(10, 2),
        rate DECIMAL(10, 2),
        subtotal DECIMAL(15, 2),
        estimated_weight DECIMAL(10, 2),
        actual_weight DECIMAL(10, 2),
        rate_at_collection DECIMAL(10, 2),
        FOREIGN KEY (pickup_id) REFERENCES pickups(id) ON DELETE CASCADE,
        FOREIGN KEY (scrap_item_id) REFERENCES scrap_items(id),
        UNIQUE KEY unique_pickup_item (pickup_id, scrap_item_id)
      )
    `);

    // Create Pickup Images table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS pickup_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pickup_id INT,
        image_url VARCHAR(255),
        FOREIGN KEY (pickup_id) REFERENCES pickups(id) ON DELETE CASCADE
      )
    `);

    // Create Admins table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) DEFAULT 'Super Admin',
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create Reviews table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pickup_id INT UNIQUE,
        customer_id INT,
        vendor_id INT,
        rating INT CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pickup_id) REFERENCES pickups(id) ON DELETE CASCADE,
        FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (vendor_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Create WhatsApp Auth table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_auth (
        session_id VARCHAR(255) PRIMARY KEY,
        data LONGTEXT
      )
    `);

    // --- MIGRATIONS ---
    try {
      await db.execute("ALTER TABLE pickups MODIFY COLUMN status ENUM('pending', 'assigned', 'accepted', 'arriving', 'on_the_way', 'reached', 'started', 'completed', 'cancelled') DEFAULT 'pending'");
      console.log("  ✅ Updated status ENUM for pickups");
    } catch (e) {
      console.error("  ⚠️ Migration pickups.status:", e.message);
    }

    await safeAddColumn("pickups", "vendor_confirmed", "TINYINT(1) DEFAULT 0");
    await safeAddColumn("pickups", "customer_confirmed", "TINYINT(1) DEFAULT 0");
    await safeAddColumn("pickups", "payment_status", "ENUM('pending', 'paid') DEFAULT 'pending'");
    await safeAddColumn("pickups", "cancelled_by", "ENUM('customer', 'vendor', 'admin') NULL");
    await safeAddColumn("pickups", "cancelled_at", "TIMESTAMP NULL");
    await safeAddColumn("pickups", "estimated_weight_range", "VARCHAR(50) NULL");
    await safeAddColumn("pickups", "vehicle_type", "VARCHAR(50) NULL");

    await safeAddColumn("pickup_items", "item_name", "VARCHAR(255) NULL");
    await safeAddColumn("pickup_items", "weight", "DECIMAL(10, 2) DEFAULT 0.00");
    await safeAddColumn("pickup_items", "rate", "DECIMAL(10, 2) NULL");
    await safeAddColumn("pickup_items", "subtotal", "DECIMAL(15, 2) NULL");
    await safeAddColumn("pickup_items", "estimated_weight", "DECIMAL(10, 2) NULL");
    await safeAddColumn("pickup_items", "actual_weight", "DECIMAL(10, 2) NULL");
    await safeAddColumn("pickup_items", "rate_at_collection", "DECIMAL(10, 2) NULL");

    try {
      await db.execute("ALTER TABLE pickup_items ADD UNIQUE KEY unique_pickup_item (pickup_id, scrap_item_id)");
      console.log("  ✅ Added unique constraint to pickup_items");
    } catch (e) {}

    await db.execute(`
      CREATE TABLE IF NOT EXISTS donations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        pickup_id INT,
        user_id INT,
        vendor_id INT,
        ngo_id INT,
        items_summary TEXT,
        estimated_value DECIMAL(15, 2) DEFAULT 0.00,
        status ENUM('pending', 'paid', 'verified') DEFAULT 'pending',
        paid_at TIMESTAMP NULL,
        transaction_id VARCHAR(255),
        proof_image LONGTEXT,
        is_approved TINYINT(1) DEFAULT 0,
        approved_at TIMESTAMP NULL,
        certificate_url TEXT,
        certificate_sent TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (pickup_id) REFERENCES pickups(id) ON DELETE SET NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Donation migrations
    await safeAddColumn("donations", "pickup_id", "INT NULL");
    await safeAddColumn("donations", "ngo_id", "INT NULL");
    await safeAddColumn("donations", "status", "ENUM('pending', 'paid', 'verified') DEFAULT 'pending'");
    await safeAddColumn("donations", "paid_at", "TIMESTAMP NULL");
    await safeAddColumn("donations", "transaction_id", "VARCHAR(255) NULL");
    await safeAddColumn("donations", "proof_image", "LONGTEXT NULL");
    await safeAddColumn("donations", "is_approved", "TINYINT(1) DEFAULT 0");
    await safeAddColumn("donations", "approved_at", "TIMESTAMP NULL");
    await safeAddColumn("donations", "certificate_url", "TEXT NULL");
    await safeAddColumn("donations", "certificate_sent", "TINYINT(1) DEFAULT 0");

    // Schema Migration: fix for customer_id -> user_id mismatch
    try {
      const [cols] = await db.query("SHOW COLUMNS FROM donations");
      const hasCustomerId = cols.some(c => c.Field === 'customer_id');
      const hasUserId = cols.some(c => c.Field === 'user_id');

      if (hasCustomerId) {
        if (hasUserId) {
          console.log("♻️  Donations table: customer_id exists alongside user_id. Merging data...");
          await db.execute("UPDATE donations SET user_id = customer_id WHERE user_id IS NULL");
          await db.execute("ALTER TABLE donations DROP COLUMN customer_id");
        } else {
          console.log("♻️  Renaming customer_id to user_id in donations table...");
          for (const cname of ["donations_ibfk_1", "donations_customer_id_foreign"]) {
            try { await db.execute(`ALTER TABLE donations DROP FOREIGN KEY ${cname}`); } catch(e) {}
          }
          await db.execute("ALTER TABLE donations CHANGE customer_id user_id INT");
          await db.execute("ALTER TABLE donations ADD CONSTRAINT fk_donations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
        }
      }
    } catch(err) {
      console.error("Migration error on donations table:", err.message);
    }

    // Wallets table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS wallets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNIQUE,
        balance DECIMAL(15, 2) DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // Transactions table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS transactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        wallet_id INT,
        type ENUM('credit', 'debit') NOT NULL,
        entity VARCHAR(50),
        entity_id INT,
        amount DECIMAL(15, 2) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
      )
    `);

    // Support tickets table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        subject VARCHAR(255),
        message TEXT,
        status ENUM('open', 'in_progress', 'resolved', 'closed') DEFAULT 'open',
        admin_reply TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // NGO table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS ngos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        address TEXT,
        upi_id VARCHAR(255),
        is_active TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await safeAddColumn("ngos", "upi_id", "VARCHAR(100) NULL");
    await safeAddColumn("ngos", "bank_account", "VARCHAR(100) NULL");
    await safeAddColumn("ngos", "ifsc_code", "VARCHAR(20) NULL");

    await safeAddColumn("users", "subscription_active", "TINYINT(1) DEFAULT 0");
    await safeAddColumn("users", "subscription_expires_at", "TIMESTAMP NULL");
    await safeAddColumn("users", "full_name", "VARCHAR(255) DEFAULT NULL");
    await safeAddColumn("users", "name", "VARCHAR(255) DEFAULT NULL");

    // --- SEED ADMIN DATA ---
    const initialAdminEmail = optionalEnv("INITIAL_ADMIN_EMAIL", "");
    const initialAdminPassword = optionalEnv("INITIAL_ADMIN_PASSWORD", "");
    const adminEmail = initialAdminEmail || "admin@chandkabadi.com";

    const [admins] = await db.query("SELECT * FROM admins WHERE email = ?", [adminEmail]);
    if (admins.length === 0) {
      if (initialAdminEmail && initialAdminPassword) {
        logger.info("🛡️ Creating initial admin account from environment variables...");
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(initialAdminPassword, salt);
        await db.execute(
          "INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, ?)",
          ["Super Admin", initialAdminEmail, hashedPassword, "admin"]
        );
        logger.info("✅ Initial admin account created.");
      } else if (env.nodeEnv !== "production") {
        logger.warn("⚠️ Creating development admin account.");
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash("admin123", salt);
        await db.execute(
          "INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, ?)",
          ["Super Admin", adminEmail, hashedPassword, "admin"]
        );
        logger.info("✅ Development admin account created: admin@chandkabadi.com / admin123");
      }
    }

    logger.info("✅ Database synchronized successfully.");
  } catch (err) {
    console.error("❌ Database Fatal Error:", JSON.stringify(err, null, 2));
    throw err;
  }
};

module.exports = { initDB };

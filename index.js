const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const pino = require("pino");
const rateLimit = require("express-rate-limit");
const db = require("./config/db");
const redisClient = require("./config/redis");
const { env, optionalEnv } = require("./config/env");

const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Import Routes
const scrapRoutes = require("./routes/scrapRoutes");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const pickupRoutes = require("./routes/pickupRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const reviewRoutes = require("./routes/reviewRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const paymentRoutes = require("./routes/paymentRoutes");

const app = express();
const port = env.port;

// Middleware
app.use(helmet({
  contentSecurityPolicy: env.nodeEnv === "production" ? undefined : false,
  crossOriginEmbedderPolicy: false, // Required for Expo/RN clients
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}));
app.use(compression());
app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
app.use(
  cors({
    origin: env.corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Set trust proxy for Hostinger/Cloudflare
app.set("trust proxy", 1);

// Global rate limiter — protects all /api/* routes (300 requests per 15 min per IP)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => env.nodeEnv !== "production", // Only enforce in production
});
app.use("/api", globalLimiter);

// Routes
app.use("/api/scraps", scrapRoutes);
app.use("/api/auth", authRoutes); // OTP rate limiter is applied inside authRoutes.js
app.use("/api/admin", adminRoutes);
app.use("/api/pickups", pickupRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payments", paymentRoutes);
const walletRoutes = require("./routes/walletRoutes");
app.use("/api/wallets", walletRoutes);
const supportRoutes = require("./routes/supportRoutes");
app.use("/api/support", supportRoutes);
const leaderboardRoutes = require("./routes/leaderboardRoutes");
app.use("/api/leaderboard", leaderboardRoutes);
const smartPricingRoutes = require("./routes/smartPricingRoutes");
app.use("/api/smart-pricing", smartPricingRoutes);
const vendorRoutes = require("./routes/vendorRoutes");
app.use("/api/vendor", vendorRoutes);
const donationRoutes = require("./routes/donationRoutes");
app.use("/api/donations", donationRoutes);
const ngoRoutes = require("./routes/ngoRoutes");
app.use("/api/ngos", ngoRoutes);

// Serve static files
const path = require("path");
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public"), {
  dotfiles: 'allow' // Crucial for serving .well-known hidden folder
}));

// Explicitly serve assetlinks.json (Look for it in public/assetlinks.json for easier deployment)
app.get("/.well-known/assetlinks.json", (req, res) => {
  const filePath = path.join(__dirname, "public", "assetlinks.json");
  res.setHeader("Content-Type", "application/json");
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error("AssetLinks Error:", err);
      res.status(404).json({
        error: "AssetLinks file not found on server.",
        required_path: "public/assetlinks.json"
      });
    }
  });
});

app.get("/", (req, res) => {
  res.send("ChandKabadiWala Backend API is running!");
});

// 404 handler for unknown routes
app.use((req, res) => {
  res.status(404).json({ error: "Not Found", path: req.originalUrl });
});

// Database Initialization (Auto-migrate)
const initDB = async () => {
  try {
    console.log("🔄 Attempting to connect to database...");
    // Log the config being used (hide password)
    console.log("📄 Config:", {
      host: env.dbHost,
      user: env.dbUser,
      database: env.dbName,
    });

    // Test query
    const [rows] = await db.query("SELECT 1 + 1 AS result");
    console.log(
      "✅ Database connection test successful.",
    );

    // 🛡️ Stronger Optimization: Check if the database has any tables already
    const [allTables] = await db.query("SHOW TABLES");
    if (allTables.length > 5 && env.nodeEnv !== 'production') {
      console.log(`ℹ️ Database has ${allTables.length} tables. Skipping heavy migrations to save hourly connection limits.`);
      // Start WhatsApp Service
      const whatsappService = require("./utils/whatsappService");
      whatsappService.initWhatsApp();
      return;
    }

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
        service_range INT DEFAULT 35,
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

    // Create Pickups table (Zomato style)
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

    // Create WhatsApp Auth table for Baileys Session storage
    await db.execute(`
      CREATE TABLE IF NOT EXISTS whatsapp_auth (
        session_id VARCHAR(255) PRIMARY KEY,
        data LONGTEXT
      )
    `);

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

    // Safely update ENUM for pickups status
    try {
      await db.execute("ALTER TABLE pickups MODIFY COLUMN status ENUM('pending', 'assigned', 'accepted', 'arriving', 'on_the_way', 'reached', 'started', 'completed', 'cancelled') DEFAULT 'pending'");
      console.log("  ✅ Updated status ENUM for pickups");
    } catch (e) {
      console.error("  ⚠️ Migration pickups.status:", e.message);
    }

    // Payment confirmation columns for dual-confirm flow
    await safeAddColumn("pickups", "vendor_confirmed", "TINYINT(1) DEFAULT 0");
    await safeAddColumn(
      "pickups",
      "customer_confirmed",
      "TINYINT(1) DEFAULT 0",
    );
    await safeAddColumn(
      "pickups",
      "payment_status",
      "ENUM('pending', 'paid') DEFAULT 'pending'",
    );
    await safeAddColumn(
      "pickups",
      "cancelled_by",
      "ENUM('customer', 'vendor', 'admin') NULL",
    );
    await safeAddColumn("pickups", "cancelled_at", "TIMESTAMP NULL");
    await safeAddColumn("vendors", "service_range", "INT DEFAULT 35");

    // Pickup step 2 details
    await safeAddColumn(
      "pickups",
      "estimated_weight_range",
      "VARCHAR(50) NULL",
    );
    await safeAddColumn("pickups", "vehicle_type", "VARCHAR(50) NULL");

    // Pickup Items billing fallback details
    await safeAddColumn("pickup_items", "item_name", "VARCHAR(255) NULL");
    await safeAddColumn(
      "pickup_items",
      "weight",
      "DECIMAL(10, 2) DEFAULT 0.00",
    );
    await safeAddColumn("pickup_items", "rate", "DECIMAL(10, 2) NULL");
    await safeAddColumn("pickup_items", "subtotal", "DECIMAL(15, 2) NULL");
    await safeAddColumn(
      "pickup_items",
      "estimated_weight",
      "DECIMAL(10, 2) NULL",
    );
    await safeAddColumn("pickup_items", "actual_weight", "DECIMAL(10, 2) NULL");
    await safeAddColumn(
      "pickup_items",
      "rate_at_collection",
      "DECIMAL(10, 2) NULL",
    );

    // Add unique constraint to pickup_items if not exists
    try {
      await db.execute(
        "ALTER TABLE pickup_items ADD UNIQUE KEY unique_pickup_item (pickup_id, scrap_item_id)",
      );
      console.log("  ✅ Added unique constraint to pickup_items");
    } catch (e) {
      // Ignore if key already exists
    }

    // Donations table
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

    // Auto-migrate in case the donations table existed from earlier but was missing these
    await safeAddColumn("donations", "pickup_id", "INT NULL");
    await safeAddColumn("donations", "ngo_id", "INT NULL");
    await safeAddColumn(
      "donations",
      "status",
      "ENUM('pending', 'paid', 'verified') DEFAULT 'pending'",
    );
    await safeAddColumn("donations", "paid_at", "TIMESTAMP NULL");
    await safeAddColumn("donations", "transaction_id", "VARCHAR(255) NULL");
    await safeAddColumn("donations", "proof_image", "LONGTEXT NULL");
    await safeAddColumn("donations", "is_approved", "TINYINT(1) DEFAULT 0");
    await safeAddColumn("donations", "approved_at", "TIMESTAMP NULL");
    await safeAddColumn("donations", "certificate_url", "TEXT NULL");
    await safeAddColumn(
      "donations",
      "certificate_sent",
      "TINYINT(1) DEFAULT 0",
    );

    // Schema Migration: fix for customer_id -> user_id mismatch
    try {
      const [cols] = await db.query("SHOW COLUMNS FROM donations LIKE 'customer_id'");
      if (cols.length > 0) {
        console.log("♻️  Migrating donations table: customer_id -> user_id");
        // Try dropping known constraint names
        for (const cname of ["donations_ibfk_1", "donations_customer_id_foreign"]) {
          try { await db.execute(`ALTER TABLE donations DROP FOREIGN KEY ${cname}`); } catch (e) { }
        }
        await db.execute("ALTER TABLE donations CHANGE customer_id user_id INT");
        await db.execute("ALTER TABLE donations ADD CONSTRAINT fk_donations_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE");
      }
    } catch (err) {
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

    // Create NGO table
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

    // Donation extended fields (all safe — skips if already exists)
    await safeAddColumn("donations", "user_id", "INT NULL");
    await safeAddColumn("donations", "pickup_id", "INT NULL");
    await safeAddColumn("donations", "ngo_id", "INT NULL");
    await safeAddColumn("pickups", "donation_id", "INT NULL");
    await safeAddColumn("donations", "vendor_id", "INT NULL");
    await safeAddColumn("donations", "certificate_url", "TEXT NULL");
    await safeAddColumn(
      "donations",
      "certificate_sent",
      "TINYINT(1) DEFAULT 0",
    );
    await safeAddColumn("donations", "items_summary", "TEXT NULL");
    await safeAddColumn(
      "donations",
      "estimated_value",
      "DECIMAL(15, 2) DEFAULT 0.00",
    );
    await safeAddColumn("donations", "status", "VARCHAR(20) DEFAULT 'pending'");
    await safeAddColumn("donations", "paid_at", "TIMESTAMP NULL");
    await safeAddColumn("donations", "proof_image", "LONGTEXT NULL");
    await safeAddColumn("donations", "transaction_id", "VARCHAR(100) NULL");
    await safeAddColumn("donations", "is_approved", "TINYINT(1) DEFAULT 0");
    await safeAddColumn("donations", "approved_at", "TIMESTAMP NULL");

    // NGO table extended fields
    await safeAddColumn("ngos", "upi_id", "VARCHAR(100) NULL");
    await safeAddColumn("ngos", "bank_account", "VARCHAR(100) NULL");
    await safeAddColumn("ngos", "ifsc_code", "VARCHAR(20) NULL");

    // User subscription fields
    await safeAddColumn("users", "subscription_active", "TINYINT(1) DEFAULT 0");
    await safeAddColumn("users", "subscription_expires_at", "TIMESTAMP NULL");
    await safeAddColumn("users", "full_name", "VARCHAR(255) DEFAULT NULL");
    await safeAddColumn("users", "name", "VARCHAR(255) DEFAULT NULL");

    // --- SEED ADMIN DATA ---
    const bcrypt = require("bcryptjs");
    const initialAdminEmail = optionalEnv("INITIAL_ADMIN_EMAIL", "");
    const initialAdminPassword = optionalEnv("INITIAL_ADMIN_PASSWORD", "");
    const adminEmail = initialAdminEmail || "admin@chandkabadi.com";

    const [admins] = await db.query("SELECT * FROM admins WHERE email = ?", [
      adminEmail,
    ]);
    if (admins.length === 0) {
      if (initialAdminEmail && initialAdminPassword) {
        logger.info(
          "🛡️ Creating initial admin account from environment variables...",
        );
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(initialAdminPassword, salt);
        await db.execute(
          "INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, ?)",
          ["Super Admin", initialAdminEmail, hashedPassword, "admin"],
        );
        logger.info(
          "✅ Initial admin account created from environment variables.",
        );
      } else if (env.nodeEnv !== "production") {
        logger.warn(
          "⚠️ Creating development admin account with default credentials. Do not use in production.",
        );
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash("admin123", salt);
        await db.execute(
          "INSERT INTO admins (name, email, password, role) VALUES (?, ?, ?, ?)",
          ["Super Admin", adminEmail, hashedPassword, "admin"],
        );
        logger.info(
          "✅ Development admin account created: admin@chandkabadi.com / admin123",
        );
      } else {
        logger.warn(
          "⚠️ No admin account exists. Set INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in production.",
        );
      }
    }

    logger.info("✅ Database synchronized successfully.");

    // Start WhatsApp Service
    const whatsappService = require("./utils/whatsappService");
    whatsappService.initWhatsApp();
  } catch (err) {
    console.error("❌ Database Fatal Error:", JSON.stringify(err, null, 2));
    console.error("❌ Error Name:", err.name);
    console.error("❌ Error Code:", err.code);
    console.error("❌ Error Message:", err.message);
    if (err.sqlMessage) console.error("❌ SQL Message:", err.sqlMessage);
  }
};

// Kick off DB init — crash hard if DB is unavailable so no broken server runs
(async () => {
  try {
    await initDB();
  } catch (fatalErr) {
    logger.fatal({ err: fatalErr }, '💥 Fatal: Database initialization failed. Shutting down.');
    process.exit(1);
  }
})();

// Global error handler for production
app.use((err, req, res, next) => {
  logger.error({ err }, "🔥 Server Error");
  res.status(500).json({
    error: "Internal Server Error",
    message:
      env.nodeEnv === "production" ? "Something went wrong" : err.message,
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(
    `🚀 Server running on port ${port} and accessible on local network`,
  );
});

// Handle graceful shutdown for PM2 (Common on Hostinger)
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received. Shutting down gracefully...`);
  server.close(() => {
    logger.info('🛑 Server closed gracefully');
    process.exit(0);
  });
  // Force close after 10s if connections still hanging
  setTimeout(() => {
    logger.warn('⚠️ Forcing exit after timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const mysql = require("mysql2/promise");
const { requireEnv } = require("../config/env");

const dbConfig = {
  host: requireEnv("DB_HOST"),
  user: requireEnv("DB_USER"),
  password: requireEnv("DB_PASSWORD"),
  database: requireEnv("DB_NAME"),
};

async function check() {
  const connection = await mysql.createConnection(dbConfig);
  try {
    const [donations] = await connection.query("SELECT * FROM donations");
    console.log("--- DONATIONS ---");
    console.log(donations);

    const [pickups] = await connection.query(
      'SELECT id, type, status, vendor_id, donation_id FROM pickups WHERE type = "donate"',
    );
    console.log("--- PICKUPS (Donate type) ---");
    console.log(pickups);
  } finally {
    await connection.end();
  }
}

check();

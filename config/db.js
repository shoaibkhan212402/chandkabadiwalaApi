const mysql = require("mysql2");
const { env } = require("./env");

const pool = mysql.createPool({
  host: env.dbHost,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  waitForConnections: true,
  connectionLimit: 5, // Reduced from 10. 5 persistent connections is PLENTY for Node's asynchronous flow, mathematically doubling the safety margin for max limits.
  maxIdle: 5, // Max idle connections, the pool will close excess connections, reducing total socket count.
  idleTimeout: 60000, // Idle connections timeout, in milliseconds.
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 10000,
});

// Debug tool for connection
pool.on("error", (err) => {
  console.error("📊 Pool Error:", err);
});

module.exports = pool.promise();

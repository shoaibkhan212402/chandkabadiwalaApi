require('dotenv').config();

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optionalEnv = (name, fallback = '') => {
  const value = process.env[name];
  return value && String(value).trim() !== '' ? value : fallback;
};

const parseOrigins = (value) =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const env = {
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  port: Number(optionalEnv('PORT', '5000')),
  dbHost: requireEnv('DB_HOST'),
  dbUser: requireEnv('DB_USER'),
  dbPassword: requireEnv('DB_PASSWORD'),
  dbName: requireEnv('DB_NAME'),
  jwtSecret: requireEnv('JWT_SECRET'),
  razorpayKeyId: requireEnv('RAZORPAY_KEY_ID'),
  razorpayKeySecret: requireEnv('RAZORPAY_KEY_SECRET'),
  corsOrigins: parseOrigins(
    optionalEnv(
      'CORS_ORIGINS',
      'https://chandkabadiwala.com,https://api.chandkabadiwala.com,http://localhost:3000,http://localhost:5173',
    ),
  ),
};

module.exports = { env, requireEnv, optionalEnv };

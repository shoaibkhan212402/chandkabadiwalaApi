const redis = require('redis');
require('dotenv').config();

// ─── Graceful Redis Wrapper ──────────────────────────────────────────
// If Redis is unavailable (network down, cloud issue), the app continues
// without caching instead of crashing. Every method becomes a safe no-op.
class SafeRedisClient {
  constructor() {
    this._client = null;
    this._connected = false;
    this._fallbackMap = new Map(); // Powerful in-memory fallback
    this._init();
  }

  async _init() {
    if (!process.env.REDIS_URL) {
      console.warn('⚠️  REDIS_URL not set — running with local memory cache');
      return;
    }

    try {
      this._client = redis.createClient({ url: process.env.REDIS_URL });
      this._client.on('error', (err) => {
        if (this._connected) console.error('❌ Redis Error:', err.message);
        this._connected = false;
      });
      this._client.on('ready', () => {
        this._connected = true;
        console.log('✅ Redis Connected (Cloud Cache Active)');
      });
      await this._client.connect();
    } catch (err) {
      console.error('❌ Redis Connection Failed — falling back to local memory cache:', err.message);
      this._client = null;
    }
  }

  async get(key) {
    if (!this._connected || !this._client) return this._fallbackMap.get(key) || null;
    try { return await this._client.get(key); } catch { return this._fallbackMap.get(key) || null; }
  }

  async set(key, value, options) {
    if (!this._connected || !this._client) {
        this._fallbackMap.set(key, value);
        if (options && options.EX) setTimeout(() => this._fallbackMap.delete(key), options.EX * 1000);
        return;
    }
    try { await this._client.set(key, value, options); } catch {
        this._fallbackMap.set(key, value);
        if (options && options.EX) setTimeout(() => this._fallbackMap.delete(key), options.EX * 1000);
    }
  }

  async setEx(key, ttl, value) {
    if (!this._connected || !this._client) {
        this._fallbackMap.set(key, value);
        setTimeout(() => this._fallbackMap.delete(key), ttl * 1000);
        return;
    }
    try { await this._client.setEx(key, ttl, value); } catch {
        this._fallbackMap.set(key, value);
        setTimeout(() => this._fallbackMap.delete(key), ttl * 1000);
    }
  }

  async del(keyOrKeys) {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
    if (!this._connected || !this._client) {
        keys.forEach(k => this._fallbackMap.delete(k));
        return;
    }
    try { await this._client.del(keys); } catch {
        keys.forEach(k => this._fallbackMap.delete(k));
    }
  }

  async keys(pattern) {
    if (!this._connected || !this._client) return Array.from(this._fallbackMap.keys());
    try { return await this._client.keys(pattern); } catch { return Array.from(this._fallbackMap.keys()); }
  }

  get isConnected() { return this._connected; }
}

const redisClient = new SafeRedisClient();
module.exports = redisClient;


const { initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const db = require('../config/db');

/**
 * Custom MySQL-backed Auth State for Baileys
 * This allows "Master" and "Slave" servers (local vs host) to share 
 * the exact same WhatsApp Web session without re-scanning QR codes.
 */
const useMySQLAuthState = async (sessionId = 'default') => {
    // Simple in-memory cache to reduce DB load
    const cache = new Map();

    // 1. Helper to Read from DB
    const readData = async (id) => {
        if (cache.has(id)) return cache.get(id);
        try {
            const [rows] = await db.query('SELECT data FROM whatsapp_auth WHERE session_id = ?', [id]);
            if (rows.length > 0) {
                const parsed = JSON.parse(rows[0].data, BufferJSON.reviver);
                cache.set(id, parsed);
                return parsed;
            }
            return null;
        } catch (error) {
            console.error('MySQL Read Error:', error);
            return null;
        }
    };

    // 2. Helper to Write to DB
    const writeData = async (data, id) => {
        try {
            cache.set(id, data);
            const value = JSON.stringify(data, BufferJSON.replacer);
            // Insert or Update (Upsert)
            await db.query(
                'INSERT INTO whatsapp_auth (session_id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
                [id, value]
            );
        } catch (error) {
            console.error('MySQL Write Error:', error);
        }
    };

    // 3. Helper to Delete from DB
    const removeData = async (id) => {
        try {
            cache.delete(id);
            await db.query('DELETE FROM whatsapp_auth WHERE session_id = ?', [id]);
        } catch (error) {
            console.error('MySQL Delete Error:', error);
        }
    };

    // Fetch initial credentials
    const credsId = `${sessionId}_creds`;
    let creds = await readData(credsId);
    if (!creds) {
        creds = initAuthCreds();
        await writeData(creds, credsId);
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${sessionId}_${type}_${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${sessionId}_${category}_${id}`;
                            if (value) {
                                tasks.push(writeData(value, key));
                            } else {
                                tasks.push(removeData(key));
                            }
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, credsId);
        }
    };
};

module.exports = { useMySQLAuthState };

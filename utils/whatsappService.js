const { default: makeWASocket, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const qrcodeTerminal = require("qrcode-terminal");
const QRCode = require('qrcode');
const { useMySQLAuthState } = require('./useMySQLAuthState');
const db = require('../config/db');

let sock = null;
let isReady = false;
let latestQrUrl = null;

const startWhatsApp = async () => {
  // Use MySQL Database instead of local file so local/host share same WhatsApp session
  const { state, saveCreds } = await useMySQLAuthState('chandkabadi');

  let version;
  try {
    const result = await fetchLatestBaileysVersion();
    version = result.version;
  } catch (err) {
    version = [2, 3000, 1015901307];
  }

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["ChandKabadiWala", "Chrome", "1.0.0"],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    emitOwnEvents: false,
    retryRequestDelayMs: 5000,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("\n📲 WhatsApp QR code generated! View it in the Admin Panel API.");
      QRCode.toDataURL(qr, { width: 400, margin: 2 }, (err, url) => {
        if (!err) latestQrUrl = url;
      });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      let shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      
      console.log(`❌ WhatsApp connection closed. Status: ${statusCode}. Reason: ${lastDisconnect?.error?.message}. Should Reconnect: ${shouldReconnect}`);
      isReady = false;
      latestQrUrl = null;

      if (shouldReconnect) {
        // Implementation of backoff to prevent DB exhaustion
        const delay = 10000; // 10 seconds
        console.log(`🔄 Scheduling reconnection in ${delay/1000}s...`);
        setTimeout(() => {
          if (!isReady) {
            console.log("🔄 Retrying WhatsApp connection...");
            startWhatsApp();
          }
        }, delay);
      } else {
        console.log("⚠️ Logged out or critical error. Manual intervention required.");
      }
    } else if (connection === "open") {
      console.log("✅ WhatsApp Connection Opened!");
      isReady = true;
      latestQrUrl = null;
    }
  });

  return sock;
};

exports.resetWhatsAppSession = async () => {
  try {
    if (sock) {
      await sock.logout();
      sock = null;
    }
  } catch (e) {}

  try {
    // Delete database entries for this session
    await db.query('DELETE FROM whatsapp_auth WHERE session_id LIKE ?', ['chandkabadi%']);
    isReady = false;
    latestQrUrl = null;
    // Re-init socket to trigger fresh QR
    setTimeout(startWhatsApp, 2000);
    return { success: true, message: "Session reset. Generating new file state..." };
  } catch (err) {
    console.error("Reset Error:", err);
    return { success: false, error: err.message };
  }
};

exports.logoutWhatsApp = async () => {
  if (sock) {
    try {
      await sock.logout();
      sock = null;
      isReady = false;
      latestQrUrl = null;
      return { success: true };
    } catch (e) {
      console.error("Logout error", e);
      return { success: false, error: e.message };
    }
  }
  return { success: true };
};

exports.reconnectWhatsApp = async () => {
  if (sock) {
    try {
      await sock.end();
    } catch (e) {}
  }
  return startWhatsApp();
};

exports.initWhatsApp = startWhatsApp;

exports.getQrCode = () => latestQrUrl;

exports.isWhatsAppReady = () => isReady;

exports.sendMessage = async (phone, text) => {
  if (!isReady || !sock) {
    console.error("WhatsApp is not connected!");
    return { success: false, error: "WhatsApp not connected" };
  }
  
  let cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
  if (!cleanPhone.includes("@s.whatsapp.net")) {
    cleanPhone = `${cleanPhone}@s.whatsapp.net`;
  }
  
  try {
    const jid = cleanPhone;
    await sock.sendMessage(jid, { text });
    return { success: true };
  } catch (e) {
    console.error("Error sending WhatsApp message", e);
    return { success: false, error: e.message };
  }
};

exports.sendOTP = async (phone, otp) => {
  const msg = `🔐 ${otp} is your OTP for Chand Kabadi Wala login.\nDo not share it with anyone`;
  return exports.sendMessage(phone, msg);
};

exports.notifyVendorsAboutPickup = async (vendors, pickupDetails) => {
  const { address, type, date } = pickupDetails;
  for (const vendor of vendors) {
    const msg = `🔔 *New Pickup Request!* 🔔\n\nType: ${type.toUpperCase()}\nLocation: ${address}\nDate: ${date}\n\nClaim this pickup in your app now! 🚛💨`;
    await exports.sendMessage(vendor.phone, msg);
  }
};

exports.sendDocument = async (phone, documentPath, fileName, caption) => {
  if (!isReady || !sock) {
    console.error("WhatsApp is not connected!");
    return { success: false, error: "WhatsApp not connected" };
  }
  
  let cleanPhone = phone.replace(/\D/g, "");
  if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
  if (!cleanPhone.includes("@s.whatsapp.net")) {
    cleanPhone = `${cleanPhone}@s.whatsapp.net`;
  }
  
  try {
    const jid = cleanPhone;
    await sock.sendMessage(jid, { 
      document: require('fs').readFileSync(documentPath), 
      mimetype: 'application/pdf', 
      fileName: fileName,
      caption: caption 
    });
    return { success: true };
  } catch (e) {
    console.error("Error sending WhatsApp document", e);
    return { success: false, error: e.message };
  }
};


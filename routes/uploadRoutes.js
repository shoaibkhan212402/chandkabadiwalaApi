const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadToFTP = require('../utils/ftpUploader');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists on startup
const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({ dest: uploadsDir });

router.post('/', upload.single('image'), async (req, res) => {
    console.log('📥 [BACKEND] Incoming upload request from mobile...');
    if (!req.file) {
        return res.status(400).json({ error: 'No image provided' });
    }

    try {
        const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
        const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;
        const publicFtpUrl = `https://chandkabadiwala.com/images/${fileName}`;
        const localPath = req.file.path;

        // ✅ Respond IMMEDIATELY with the expected FTP URL.
        // The client gets its response in <1s, no timeout risk.
        res.setHeader('Connection', 'close');
        res.json({ url: publicFtpUrl, message: 'Upload received. Syncing to server...' });

        // ⬆️ Push to FTP in the background (non-blocking)
        setImmediate(async () => {
            try {
                await uploadToFTP(localPath, fileName);
                console.log(`✅ FTP sync complete: ${fileName}`);
            } catch (ftpErr) {
                console.error(`❌ FTP sync failed for ${fileName}:`, ftpErr.message);
                // File stays in /uploads as fallback — admin can retrieve if needed
            }
        });

    } catch (err) {
        console.error('Upload route error:', err);
        res.status(500).json({ error: 'Upload failed', details: err.message });
    }
});

module.exports = router;

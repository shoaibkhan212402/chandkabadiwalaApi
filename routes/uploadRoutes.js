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
    console.log('📥 [BACKEND] Incoming upload request...');
    if (!req.file) {
        return res.status(400).json({ error: 'No image provided' });
    }

    const localPath = req.file.path;
    try {
        const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
        const fileName = `${Date.now()}_${Math.floor(Math.random() * 1000)}${ext}`;

        // Upload to FTP synchronously
        console.log(`⬆️ Uploading ${fileName} to FTP...`);
        const publicFtpUrl = await uploadToFTP(localPath, fileName);
        console.log(`✅ FTP upload complete: ${fileName}`);

        res.json({ url: publicFtpUrl, message: 'Upload successful.' });
    } catch (err) {
        console.error('Upload route error:', err);
        // Clean up the local file if it still exists
        if (fs.existsSync(localPath)) {
            try {
                fs.unlinkSync(localPath);
            } catch (unlinkErr) {
                console.error('Failed to unlink local temp file after failure:', unlinkErr);
            }
        }
        res.status(500).json({ error: 'Upload failed', details: err.message });
    }
});

module.exports = router;

const ftp = require('basic-ftp');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const redisClient = require('../config/redis');
require('dotenv').config();

async function run() {
  console.log('🔄 Connecting to FTP server and uploading catalog images...');
  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    // 1. Connect to FTP
    await client.access({
      host: process.env.FTP_HOST,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASSWORD,
      secure: false
    });

    console.log('✅ FTP connection successful. Ensuring "images" directory exists...');
    await client.ensureDir('images');

    // 2. Identify catalog images to upload
    const imagesToUpload = [
      { localName: 'corrugated_box.png', dbId: 3, name: 'Corrugated Box / Gatta' },
      { localName: 'books_copies.png', dbId: 4, name: 'Books / Copies' },
      { localName: 'a3_a4_paper.png', dbId: 7, name: 'A3/A4 Paper' },
      { localName: 'newspaper.png', dbId: 2, name: 'News Paper' }
    ];

    const localUploadsDir = path.join(__dirname, '../uploads');

    for (const img of imagesToUpload) {
      const localFilePath = path.join(localUploadsDir, img.localName);
      if (!fs.existsSync(localFilePath)) {
        console.warn(`⚠️ Warning: Local file not found at ${localFilePath}, skipping FTP upload for this file.`);
        continue;
      }

      console.log(`⬆️ Uploading ${img.localName} to FTP...`);
      await client.uploadFrom(localFilePath, img.localName);
      console.log(`✅ Uploaded ${img.localName} successfully!`);
    }

    console.log('🔄 FTP upload complete. Updating MySQL database image references to use public FTP URLs...');

    // 3. Update Database
    for (const img of imagesToUpload) {
      const publicUrl = `https://chandkabadiwala.com/images/${img.localName}`;
      await db.execute(
        'UPDATE scrap_items SET image = ? WHERE id = ?',
        [publicUrl, img.dbId]
      );
      console.log(`✅ Updated DB ID ${img.dbId} (${img.name}) -> ${publicUrl}`);
    }

    // 4. Clear Redis Cache
    console.log('🔄 Clearing Redis scraps cache...');
    const keys = await redisClient.keys('scraps:*');
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`✅ Cleared ${keys.length} cached scraps keys in Redis`);
    } else {
      console.log('ℹ️ No cached scraps keys in Redis');
    }

    console.log('🎉 Catalog images synced to FTP and database references updated successfully!');
    process.exit(0);

  } catch (err) {
    console.error('❌ Error during catalog image synchronization:', err);
    process.exit(1);
  } finally {
    client.close();
  }
}

// Introduce a short delay to allow db and redis pool initialization if needed
setTimeout(run, 1000);

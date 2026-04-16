const ftp = require('basic-ftp');
const fs = require('fs');

const uploadToFTP = async (localFilePath, remoteFileName) => {
    const client = new ftp.Client();
    client.ftp.verbose = true;
    
    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASSWORD,
            secure: false
        });

        // The FTP account lands directly in /public_html, so we navigate into /images
        await client.ensureDir('images');
        await client.uploadFrom(localFilePath, remoteFileName);
        
        // Remove local file after successful upload
        fs.unlinkSync(localFilePath);
        
        return `https://chandkabadiwala.com/images/${remoteFileName}`;
    } catch (err) {
        console.error('❌ FTP Upload Error:', err);
        // Do not unlink file here, let uploadRoutes handle local fallback
        throw err;
    } finally {
        client.close();
    }
};

module.exports = uploadToFTP;

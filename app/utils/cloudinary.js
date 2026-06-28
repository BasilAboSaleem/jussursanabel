const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const path = require('path');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const fs = require('fs');
const uploadDir = path.join(process.cwd(), 'public/uploads');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
 
const storage = multer.diskStorage({
    destination: function (req, file, cb) { 
        cb(null, uploadDir)
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname))
    }
});

const upload = multer({ storage: storage });

function isCloudinaryConfigured() {
    return Boolean(
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
    );
}

/**
 * Persist a chat image: Cloudinary when configured, otherwise local /uploads/ path.
 * @param {string} filePath - Absolute path from multer
 * @returns {Promise<string>}
 */
async function persistChatImage(filePath) {
    const localUrl = `/uploads/${path.basename(filePath)}`;

    if (!isCloudinaryConfigured()) {
        return localUrl;
    }

    try {
        const result = await cloudinary.uploader.upload(filePath, { folder: 'jussur/chat' });
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return result.secure_url;
    } catch (err) {
        console.error('Cloudinary upload failed, using local storage:', err.message);
        return localUrl;
    }
}

module.exports = { cloudinary, upload, isCloudinaryConfigured, persistChatImage };

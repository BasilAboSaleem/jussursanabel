const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { protect, restrictTo } = require('../middlewares/auth');
const { upload } = require('../utils/cloudinary');
const { csrfProtection } = require('../middlewares/csrf');

router.use(protect);

router.get('/settings', profileController.getSettings);
router.get('/force-password-change', profileController.getForcePasswordChange);
router.post('/update', upload.single('avatar'), csrfProtection, profileController.updateProfile);
router.post('/password', profileController.updatePassword);
router.post('/chat-window', restrictTo('donor'), profileController.saveChatWindow);

module.exports = router;

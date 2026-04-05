const express = require('express');
const router = express.Router();
const profileController = require('../controllers/profileController');
const { protect } = require('../middlewares/auth');
const { upload } = require('../utils/cloudinary');

router.use(protect);

router.get('/settings', profileController.getSettings);
router.post('/update', upload.single('avatar'), profileController.updateProfile);
router.post('/password', profileController.updatePassword);
router.post('/chat-window', profileController.saveChatWindow);

module.exports = router;

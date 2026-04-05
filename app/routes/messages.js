const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { protect } = require('../middlewares/auth');
const multer = require('multer');
const upload = multer({ dest: 'public/uploads/' });

router.use(protect);

router.get('/', messageController.getMessages);
router.get('/:userId', messageController.getChatHistory); 
router.get('/data/:userId', messageController.getChatData);
router.post('/accept-monitoring', messageController.acceptMonitoring);
router.post('/send', upload.single('image'), messageController.sendMessage);
router.post('/request-chat', messageController.requestChat);

module.exports = router;

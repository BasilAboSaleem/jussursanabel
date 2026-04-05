const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { protect } = require('../middlewares/auth');

router.use(protect);

router.get('/', notificationController.getUserNotifications);
router.post('/:notificationId/read', notificationController.markAsRead);

module.exports = router;

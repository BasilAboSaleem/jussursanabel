const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { protect, restrictTo } = require('../middlewares/auth');

// User Routes
router.get('/chat', protect, supportController.getSupportPage);
router.post('/ticket/open', protect, supportController.openTicket);
router.post('/message/send', protect, supportController.sendMessage);

// Admin Routes
router.get('/admin/dashboard', protect, restrictTo('admin', 'super_admin', 'support'), supportController.getAdminSupportDashboard);
router.post('/admin/message/send', protect, restrictTo('admin', 'super_admin', 'support'), supportController.sendMessage);
router.post('/admin/ticket/:id/resolve', protect, restrictTo('admin', 'super_admin', 'support'), supportController.resolveTicket);

module.exports = router; 

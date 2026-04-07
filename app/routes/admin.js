const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const settingsController = require('../controllers/settingsController');
const messageController = require('../controllers/messageController');
const notificationController = require('../controllers/notificationController');
const { protect, restrictTo, viewOnly } = require('../middlewares/auth');
const { upload } = require('../utils/cloudinary');

// All admin routes are protected and restricted
router.use(protect);
// Routes explicitly open to support
router.get('/all-users', restrictTo('admin', 'super_admin', 'support'), adminController.getAllUsers);
router.post('/users/:id/status', restrictTo('admin', 'super_admin', 'regulator', 'support'), adminController.updateUserStatus);
router.get('/escalations', restrictTo('admin', 'super_admin', 'regulator', 'support'), adminController.getEscalationsCenter);
router.post('/escalations/submit', restrictTo('admin', 'super_admin', 'regulator', 'support'), adminController.submitAdminRequest);

router.use(restrictTo('admin', 'super_admin', 'regulator'));
router.use(viewOnly);

router.get('/dashboard', adminController.getAdminDashboard);
router.get('/chat-requests', messageController.adminGetRequests);
router.post('/chat-requests/handle', messageController.adminHandleRequest);
router.get('/users', adminController.getUsersManager);
// /all-users route moved up
router.get('/users/:id/moderation', restrictTo('admin', 'super_admin'), adminController.getUserOversight);
router.post('/users/create', restrictTo('super_admin'), adminController.createAdmin);
router.post('/users/:id/delete', restrictTo('super_admin'), adminController.deleteUser);
// /users/:id/status route moved up
router.post('/cases/:id/status', adminController.updateCase);
router.post('/cases/:id/toggle-satisfaction', adminController.toggleCaseSatisfaction);
router.post('/cases/:id/updates', upload.array('attachments', 10), adminController.addCaseUpdate);
router.post('/cases/:id/hard-delete', restrictTo('super_admin'), adminController.hardDeleteCase);
router.post('/cases/:id/toggle-visibility', restrictTo('super_admin'), adminController.toggleCaseVisibility);
router.post('/cases/:id/story-hard-delete', restrictTo('super_admin'), adminController.hardDeleteStory);
router.post('/cases/:id/toggle-story-visibility', restrictTo('super_admin'), adminController.toggleStoryVisibility);
router.post('/transactions/:id/status', adminController.updateTransactionStatus);
router.get('/cases-manager', adminController.getCasesManager);
router.get('/cases/:id/field-report', adminController.getFieldReportPdf);
router.get('/pending-approvals', adminController.getPendingApprovals);
router.get('/operation-fees', restrictTo('super_admin'), adminController.getOperationFeesDetail);

// System Settings (Super Admin Only)
router.get('/settings', restrictTo('super_admin'), settingsController.getSettings);
router.post('/settings/update', restrictTo('super_admin'), settingsController.updateSettings);

// Chat Monitoring
router.get('/monitor-chats', adminController.getChatMonitor);
router.get('/monitor-chats/:requestId/messages', adminController.getConversationMessages);
router.post('/moderate-user', adminController.moderateUser);

// Advanced Analytics & Logs
router.get('/analytics', adminController.getAnalytics);
router.get('/activity-logs', restrictTo('super_admin'), adminController.getActivityLogs);

// Notifications
router.get('/notifications', adminController.getNotificationsManager);
router.post('/notifications/send', notificationController.createNotification);
router.post('/notifications/:id/delete', notificationController.deleteNotification);

// Phase 11: Case Impact Proofs (Verified Updates)
router.get('/pending-impact-proofs', adminController.getPendingImpactProofs);
router.post('/impact-proofs/:id/approve', adminController.approveImpactProof);
router.post('/impact-proofs/:id/reject', adminController.rejectImpactProof);

// Admin Escalations Center (Hotline)
// get and submit routes moved up
router.post('/escalations/:id/resolve', restrictTo('super_admin'), adminController.resolveAdminRequest);

// Donation Distribution Center (توزيع السنابل)
const distributionController = require('../controllers/distributionController');
router.get('/distribution', distributionController.getDistributionCenter);
router.post('/distribution/confirm-bank', restrictTo('super_admin'), distributionController.confirmBankReceipt);
router.get('/distribution/receipt/:id', distributionController.getBankReceiptDetails);
router.post('/distribution/revert-bank/:id', restrictTo('super_admin'), distributionController.revertBankReceipt);
router.post('/distribution/generate-payout', restrictTo('super_admin'), distributionController.generatePayout);
router.post('/distribution/revert-payout/:id', restrictTo('super_admin'), distributionController.revertPayout);

// Excel Export Routes
router.get('/distribution/export/bank-transactions', distributionController.exportBankTransactions);
router.get('/distribution/export/receipts-history', distributionController.exportReceiptsHistory);
router.get('/distribution/export/payouts-history', distributionController.exportPayoutsHistory);

module.exports = router;

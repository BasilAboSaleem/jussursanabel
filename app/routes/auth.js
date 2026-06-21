const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { protect } = require('../middlewares/auth');

router.get('/login', authController.getLogin);
router.post('/login', authController.login);

router.get('/register', authController.getRegister);
router.post('/register', authController.register);

router.get('/pending', protect, authController.getPending);
router.get('/logout', authController.logout);

router.get('/forgot-password', authController.getForgotPassword);
router.post('/forgot-password', authController.forgotPassword);
router.get('/reset-password/:token', authController.getResetPassword);
router.post('/reset-password/:token', authController.resetPassword);

// AJAX Validation
router.get('/check-exists', authController.checkExists);

module.exports = router;

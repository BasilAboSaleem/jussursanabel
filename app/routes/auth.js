const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/login', authController.getLogin);
router.post('/login', authController.login);

router.get('/register', authController.getRegister);
router.post('/register', authController.register);

router.get('/logout', authController.logout);

// AJAX Validation
router.get('/check-exists', authController.checkExists);

module.exports = router;

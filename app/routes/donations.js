const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const { optionalProtect } = require('../middlewares/auth');
const { upload } = require('../utils/cloudinary');

router.use(optionalProtect);

router.get('/checkout', transactionController.getCheckout);
router.post('/process', upload.single('receipt'), transactionController.processDonation);
router.get('/success', transactionController.handleCheckoutSuccess);
router.get('/cancel', transactionController.handleCheckoutCancel);

module.exports = router;

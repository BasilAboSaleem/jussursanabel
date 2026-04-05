const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transactionController');
const { protect } = require('../middlewares/auth');
const { upload } = require('../utils/cloudinary');

router.use(protect);

router.get('/checkout', transactionController.getCheckout);
router.post('/process', upload.single('receipt'), transactionController.processDonation);

module.exports = router;

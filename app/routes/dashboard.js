const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { protect } = require('../middlewares/auth');

router.get('/', protect, dashboardController.getDashboard);
router.get('/case/:id/transactions', protect, dashboardController.getCaseTransactions);
router.post('/case/:id/toggle-satisfaction', protect, dashboardController.toggleCaseSatisfaction);
router.get('/invoice/:id', protect, dashboardController.getInvoice);

// Phase 10: Testimonials
router.post('/testimonial', protect, dashboardController.updateTestimonial);

// Phase 11: Proof of Impact (Case Updates)
const { upload } = require('../utils/cloudinary');
const csurf = require('csurf');
const csrfProtection = csurf({ cookie: true });
router.post('/case/:id/proof-of-impact', protect, upload.array('images', 5), csrfProtection, dashboardController.uploadProofOfImpact);

module.exports = router;

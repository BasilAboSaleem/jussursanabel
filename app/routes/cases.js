const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const { protect, restrictTo } = require('../middlewares/auth');
const { upload } = require('../utils/cloudinary');
const { pageCache } = require('../middlewares/cache');

// Protected (For beneficiaries and donors)
router.get('/register', protect, restrictTo('beneficiary', 'family', 'guardian'), caseController.getRegisterCase);
router.post('/register', protect, restrictTo('beneficiary', 'family', 'guardian'), upload.array('image', 3), caseController.createCase);
router.post('/:id/follow', protect, caseController.toggleFollowCase);
router.post('/:id/teams', protect, caseController.createTeam);

// Public
router.get('/', pageCache(60), caseController.getAllCases);
router.get('/:id', pageCache(45), caseController.getCaseDetails);

module.exports = router;

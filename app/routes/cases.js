const express = require('express');
const router = express.Router();
const caseController = require('../controllers/caseController');
const { protect, restrictTo } = require('../middlewares/auth');
const { upload } = require('../utils/cloudinary');

// Protected (For beneficiaries and donors)
router.get('/register', protect, restrictTo('beneficiary', 'family', 'guardian'), caseController.getRegisterCase);
router.post('/register', protect, restrictTo('beneficiary', 'family', 'guardian'), upload.single('image'), caseController.createCase);
router.post('/:id/follow', protect, caseController.toggleFollowCase);
router.post('/:id/teams', protect, caseController.createTeam);

// Public
router.get('/', caseController.getAllCases);
router.get('/:id', caseController.getCaseDetails);

module.exports = router;

const express = require('express');
const router = express.Router();
const indexController = require('../controllers/indexController');

router.get('/', indexController.getHomepage);
router.get('/about', indexController.getAbout);
router.get('/contact', indexController.getContact);
router.get('/transparency', indexController.getTransparency);

router.get('/lang/:locale', (req, res) => {
    const locale = req.params.locale;
    if (['ar', 'en'].includes(locale)) {
        res.cookie('lang', locale, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: true });
    }
    const backURL = req.header('Referer') || '/';
    res.redirect(backURL);
});

module.exports = router;

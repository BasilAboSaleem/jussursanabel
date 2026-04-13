const express = require('express');
const router = express.Router();
const indexController = require('../controllers/indexController');
const { pageCache } = require('../middlewares/cache');

router.get('/', pageCache(90), indexController.getHomepage);
router.get('/stories', pageCache(120), indexController.getStoriesHub);
router.get('/contact', pageCache(300), indexController.getContact);
router.get('/transparency', pageCache(300), indexController.getTransparency);

router.get('/lang/:locale', (req, res) => {
    const locale = req.params.locale;
    if (['ar', 'en'].includes(locale)) {
        res.cookie('lang', locale, { maxAge: 1000 * 60 * 60 * 24 * 365, httpOnly: true });
    }
    const backURL = req.header('Referer') || '/';
    res.redirect(backURL);
});

module.exports = router;

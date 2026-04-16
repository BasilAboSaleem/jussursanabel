const express = require('express');
const router = express.Router();
const indexController = require('../controllers/indexController');
const { pageCache } = require('../middlewares/cache');

router.get('/', pageCache(90), indexController.getHomepage);
router.get('/stories', pageCache(120), indexController.getStoriesHub);
router.get('/contact', pageCache(300), indexController.getContact);
router.post('/contact', indexController.postContact);
router.get('/transparency', pageCache(300), indexController.getTransparency);

router.get('/lang/:locale', (req, res) => {
    const locale = req.params.locale;
    if (['ar', 'en'].includes(locale)) {
        res.cookie('lang', locale, {
            maxAge: 1000 * 60 * 60 * 24 * 365,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            path: '/'
        });
    }

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const referer = req.header('Referer');
    const host = `${req.protocol}://${req.get('host')}`;

    let targetPath = '/';
    if (referer) {
        try {
            const parsed = new URL(referer);
            if (parsed.origin === host) {
                parsed.searchParams.delete('lang');
                parsed.searchParams.set('nocache', '1');
                targetPath = parsed.pathname + parsed.search;
            }
        } catch (_) {}
    }

    res.redirect(targetPath);
});

module.exports = router;

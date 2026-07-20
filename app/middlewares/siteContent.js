const { loadSiteContentSettings, resolveSiteText } = require('../utils/siteContentSettings');

async function siteContentMiddleware(req, res, next) {
    try {
        const content = await loadSiteContentSettings();
        const locale = req.getLocale();
        const translate = res.__.bind(res);

        res.locals.siteContent = content;
        res.locals.siteText = (key) => resolveSiteText(content, key, locale, translate);
        next();
    } catch (err) {
        console.error('[siteContent]', err);
        res.locals.siteContent = {};
        res.locals.siteText = (key) => res.__(key);
        next();
    }
}

module.exports = siteContentMiddleware;

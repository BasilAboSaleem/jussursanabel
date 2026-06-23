const csurf = require('csurf');
const { csrfCookieOptions } = require('../config/security');

const csrfProtection = csurf({
  cookie: csrfCookieOptions(),
});

/**
 * Global CSRF runs before route-level multer, so multipart POST bodies are not parsed yet.
 * Those routes skip global validation and enforce CSRF after multer on the router.
 */
function isMultipartCsrfDeferred(req) {
  const url = (req.originalUrl || '').split('?')[0];

  if (url === '/donations/webhook') return true;

  if (url.includes('/proof-of-impact')) return true;
  if (url.includes('/updates') && url.startsWith('/admin/cases/')) return true;
  if (url.includes('/media-content')) return true;
  if (url.startsWith('/admin/cases/') && url.endsWith('/status')) return true;

  if (req.method === 'POST') {
    if (url === '/cases/register') return true;
    if (url === '/profile/update') return true;
  }

  return false;
}

function shouldSkipGlobalCsrf(req) {
  return isMultipartCsrfDeferred(req);
}

module.exports = {
  csrfProtection,
  isMultipartCsrfDeferred,
  shouldSkipGlobalCsrf,
};

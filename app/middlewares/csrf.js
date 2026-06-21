const csurf = require('csurf');

const isProduction = process.env.NODE_ENV === 'production';

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: process.env.CSRF_SAME_SITE || 'lax',
  },
});

/**
 * Global CSRF runs before route-level multer, so multipart POST bodies are not parsed yet.
 * Those routes skip global validation and enforce CSRF after multer on the router.
 */
function shouldSkipGlobalCsrf(req) {
  const url = (req.originalUrl || '').split('?')[0];

  if (url === '/donations/webhook') return true;

  if (url.includes('/proof-of-impact')) return true;
  if (url.includes('/updates') && url.startsWith('/admin')) return true;
  if (url.includes('/media-content')) return true;
  if (url.startsWith('/admin/cases/') && url.endsWith('/status')) return true;

  if (req.method === 'POST') {
    if (url === '/cases/register') return true;
    if (url === '/profile/update') return true;
  }

  return false;
}

module.exports = { csrfProtection, shouldSkipGlobalCsrf };

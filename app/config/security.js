const isProduction = process.env.NODE_ENV === 'production';

function useSecureCookies() {
  return isProduction || process.env.FORCE_SECURE_COOKIES === 'true';
}

function resolveTrustProxy() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '') {
    return isProduction ? 1 : false;
  }
  if (raw === 'true') return 1;
  if (raw === 'false') return false;
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

function buildHelmetConfig() {
  const secure = useSecureCookies();

  return {
    hidePoweredBy: true,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdnjs.cloudflare.com',
          'https://cdn.jsdelivr.net',
          'https://js.stripe.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com',
          'https://cdn.jsdelivr.net',
        ],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
        connectSrc: [
          "'self'",
          'https://api.stripe.com',
          'https://res.cloudinary.com',
          'wss:',
          'ws:',
        ],
        frameSrc: [
          "'self'",
          'https://checkout.stripe.com',
          'https://js.stripe.com',
          'https://hooks.stripe.com',
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'https://www.google.com',
        ],
        mediaSrc: ["'self'", 'https:', 'blob:'],
        formAction: ["'self'", 'https://checkout.stripe.com'],
        workerSrc: ["'self'"],
        manifestSrc: ["'self'"],
        ...(secure ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: secure ? { maxAge: 31536000, includeSubDomains: true, preload: false } : false,
  };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    maxAge: 1000 * 60 * 60 * 24,
    sameSite: process.env.SESSION_SAME_SITE || 'lax',
  };
}

function csrfCookieOptions() {
  return {
    httpOnly: true,
    secure: useSecureCookies(),
    sameSite: process.env.CSRF_SAME_SITE || process.env.SESSION_SAME_SITE || 'lax',
  };
}

module.exports = {
  isProduction,
  useSecureCookies,
  resolveTrustProxy,
  buildHelmetConfig,
  sessionCookieOptions,
  csrfCookieOptions,
};

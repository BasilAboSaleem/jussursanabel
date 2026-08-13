/**
 * HTTP smoke tests for public pages and guest donation flow.
 *
 * Usage: node scripts/verify-http-smoke.js
 */
require('dotenv').config();

const { getStripeSecretKey } = require('../app/utils/stripeConfig');
const baseUrl = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function fetchWithCookies(url, options = {}, jar = {}) {
    const headers = { ...(options.headers || {}) };
    const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookieHeader) headers.Cookie = cookieHeader;

    const response = await fetch(url, {
        ...options,
        headers,
        redirect: 'manual'
    });

    const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const raw of setCookie) {
        const part = raw.split(';')[0];
        const eq = part.indexOf('=');
        if (eq > 0) {
            jar[part.slice(0, eq)] = part.slice(eq + 1);
        }
    }

    const body = await response.text();
    return { response, body, jar };
}

function extractCsrfToken(html) {
    const match = html.match(/name="_csrf"\s+value="([^"]+)"/);
    return match ? match[1] : null;
}

async function main() {
    console.log(`HTTP smoke tests against ${baseUrl}`);

    const publicPaths = ['/', '/cases', '/about', '/contact', '/transparency', '/auth/login'];
    for (const path of publicPaths) {
        const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' });
        if (res.status !== 200) {
            throw new Error(`${path} expected 200, got ${res.status}`);
        }
    }
    console.log(`✓ Public pages HTTP 200 (${publicPaths.length})`);

    const caseId = process.env.VERIFY_CASE_ID || '69e9edb4bf8831ae618cda77';
    const caseRes = await fetch(`${baseUrl}/cases/${caseId}`, { redirect: 'manual' });
    if (caseRes.status === 200) {
        console.log('✓ Sample case details HTTP 200');
    } else {
        const casesRes = await fetch(`${baseUrl}/cases`, { redirect: 'manual' });
        if (casesRes.status !== 200) {
            throw new Error('Could not load cases listing');
        }
        console.log('ℹ Sample case unavailable; cases listing OK');
    }

    const jar = {};
    const checkoutUrl = `${baseUrl}/donations/checkout?case=${caseId}&type=direct`;
    const checkoutGet = await fetchWithCookies(checkoutUrl, {}, jar);

    if (checkoutGet.response.status !== 200) {
        const loc = checkoutGet.response.headers.get('location') || '';
        throw new Error(`Guest checkout expected 200, got ${checkoutGet.response.status} (location: ${loc})`);
    }

    if (checkoutGet.body.includes('guestName') || checkoutGet.body.includes('checkout_guest_heading')) {
        throw new Error('Guest donor form should not appear on checkout');
    }
    console.log('✓ Guest checkout accessible without login');

    const csrfToken = extractCsrfToken(checkoutGet.body);
    if (!csrfToken) {
        throw new Error('CSRF token missing on checkout page');
    }

    const postBody = new URLSearchParams({
        _csrf: csrfToken,
        caseId,
        amount: '50',
        type: 'direct',
        isFeeCovered: 'true'
    });

    const postRes = await fetchWithCookies(`${baseUrl}/donations/process`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html'
        },
        body: postBody.toString()
    }, jar);

    const location = postRes.response.headers.get('location') || '';
    if (postRes.response.status !== 302 && postRes.response.status !== 303) {
        throw new Error(`Guest donation POST expected redirect, got ${postRes.response.status}`);
    }

    if (getStripeSecretKey()) {
        if (!location.includes('checkout.stripe.com') && !location.includes('stripe.com')) {
            throw new Error(`Expected Stripe redirect, got: ${location}`);
        }
        console.log('✓ Guest donation POST redirects to Stripe');
    } else {
        console.log('ℹ Stripe not configured — redirect status verified');
    }

    console.log('HTTP smoke verification completed.');
}

main().catch((err) => {
    console.error('HTTP smoke verification failed:', err.message);
    process.exit(1);
});

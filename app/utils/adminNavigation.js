/**
 * Resolves the logical parent URL for admin back navigation
 * (hierarchy-aware, not browser history).
 */
function resolveAdminBackUrl(pathname) {
    const path = String(pathname || '')
        .split('?')[0]
        .replace(/\/$/, '') || '/admin/dashboard';

    if (path === '/admin/dashboard') {
        return null;
    }

    const rules = [
        { test: /^\/admin\/users\/[^/]+\/moderation$/, parent: '/admin/all-users' },
        { test: /^\/admin\/cases\/[^/]+\/(media-review|field-report)$/, parent: '/admin/cases-manager' },
        { test: /^\/admin\/distribution\/(receipt|export|payout-receipt)\//, parent: '/admin/distribution' },
        { test: /^\/admin\/password-recovery$/, parent: '/admin/settings' },
        { test: /^\/admin\/pending-impact-proofs$/, parent: '/admin/analytics' },
        { test: /^\/support\/admin(?:\/|$)/, parent: '/admin/dashboard' },
        { test: /^\/admin\//, parent: '/admin/dashboard' },
    ];

    for (const rule of rules) {
        if (rule.test.test(path)) {
            return rule.parent;
        }
    }

    return '/admin/dashboard';
}

module.exports = {
    resolveAdminBackUrl,
};

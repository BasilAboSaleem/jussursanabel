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

/**
 * Resolves a Font Awesome icon class for the current dashboard page (top bar).
 */
function resolveDashboardPageIcon(pathname, options = {}) {
    const path = String(pathname || '')
        .split('?')[0]
        .replace(/\/$/, '') || '/';
    const user = options.user || null;

    const rules = [
        [/^\/admin\/dashboard$/, 'fas fa-chart-line'],
        [
            /^\/admin\/cases-manager$/,
            () => (user && user.role === 'media' ? 'fas fa-photo-film' : 'fas fa-folder-open'),
        ],
        [/^\/admin\/cases\/[^/]+\/media-review$/, 'fas fa-photo-film'],
        [/^\/admin\/cases\/[^/]+\/field-report$/, 'fas fa-clipboard-check'],
        [/^\/admin\/chat-requests$/, 'fas fa-comments'],
        [/^\/support\/admin(?:\/|$)/, 'fas fa-headset'],
        [/^\/admin\/monitor-chats$/, 'fas fa-shield-halved'],
        [/^\/admin\/analytics$/, 'fas fa-chart-pie'],
        [/^\/admin\/distribution/, 'fas fa-hand-holding-dollar'],
        [/^\/admin\/activity-logs$/, 'fas fa-binoculars'],
        [/^\/admin\/pending-approvals$/, 'fas fa-user-clock'],
        [/^\/admin\/escalations/, 'fas fa-tower-observation'],
        [/^\/admin\/all-users$/, 'fas fa-users'],
        [/^\/admin\/users\/[^/]+\/moderation$/, 'fas fa-tower-observation'],
        [/^\/admin\/content-management$/, 'fas fa-wand-magic-sparkles'],
        [/^\/admin\/users$/, 'fas fa-users-cog'],
        [/^\/admin\/donations-ledger/, 'fas fa-receipt'],
        [/^\/admin\/operation-fees$/, 'fas fa-chart-line'],
        [/^\/admin\/settings$/, 'fas fa-cogs'],
        [/^\/admin\/password-recovery$/, 'fas fa-key'],
        [/^\/admin\/pending-impact-proofs$/, 'fa-solid fa-shield-check'],
        [/^\/admin\/notifications/, 'fas fa-envelope-open-text'],
        [/^\/dashboard/, 'fas fa-home'],
        [/^\/messages/, 'fas fa-comments'],
        [/^\/profile\/settings$/, 'fas fa-user-gear'],
        [/^\/profile\/force-password/, 'fas fa-lock'],
        [/^\/notifications/, 'fas fa-bell'],
        [/^\/cases\/register/, 'fas fa-file-circle-plus'],
        [/^\/donor\/invoice/, 'fas fa-file-invoice'],
    ];

    for (const [test, icon] of rules) {
        if (test.test(path)) {
            return typeof icon === 'function' ? icon() : icon;
        }
    }

    if (path.startsWith('/admin/') || path.startsWith('/support/admin')) {
        return 'fas fa-shield-alt';
    }

    return null;
}

module.exports = {
    resolveAdminBackUrl,
    resolveDashboardPageIcon,
};

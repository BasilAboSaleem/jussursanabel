const ADMIN_PANEL_ROLES = ['admin', 'super_admin', 'regulator', 'support', 'media'];

function getRole(userOrRole) {
    return typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
}

function usesAdminPanel(userOrRole) {
    return ADMIN_PANEL_ROLES.includes(getRole(userOrRole));
}

function isSuperAdmin(userOrRole) {
    return getRole(userOrRole) === 'super_admin';
}

function isBrandedStaffAvatar(userOrRole) {
    const role = getRole(userOrRole);
    return role === 'admin' || role === 'super_admin';
}

module.exports = {
    ADMIN_PANEL_ROLES,
    usesAdminPanel,
    isSuperAdmin,
    isBrandedStaffAvatar,
};

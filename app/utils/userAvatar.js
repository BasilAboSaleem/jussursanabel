const DONOR_AVATAR = '/assets/images/default-avatar-donor.svg';
const BENEFICIARY_AVATAR = '/assets/images/default-avatar-beneficiary.svg';
const GENERIC_AVATAR = '/assets/images/default-avatar.svg';

const BENEFICIARY_ROLES = new Set(['beneficiary', 'family', 'guardian']);
const STAFF_ROLES = new Set(['admin', 'super_admin', 'regulator', 'support', 'media']);

const PLACEHOLDER_PATTERNS = [
    'default-avatar',
    'placeholder-avatar',
];

function hasCustomAvatar(avatar) {
    if (!avatar || typeof avatar !== 'string') return false;
    const trimmed = avatar.trim();
    if (!trimmed) return false;
    const lower = trimmed.toLowerCase();
    return !PLACEHOLDER_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isCustomAvatarUrl(avatar) {
    if (!hasCustomAvatar(avatar)) return false;
    return /^https?:\/\//i.test(avatar);
}

function getDefaultAvatarPath(role) {
    if (role === 'donor') return DONOR_AVATAR;
    if (BENEFICIARY_ROLES.has(role)) return BENEFICIARY_AVATAR;
    return GENERIC_AVATAR;
}

function resolveUserAvatar(user) {
    if (!user) return GENERIC_AVATAR;
    const role = user.role;
    const avatar = user.avatar;
    if (hasCustomAvatar(avatar)) return avatar;
    return getDefaultAvatarPath(role);
}

function applyAvatarToUser(user) {
    if (!user) return user;
    const target = user;
    target.avatar = resolveUserAvatar(user);
    return target;
}

function applyAvatarToUsers(users) {
    if (!users) return users;
    if (Array.isArray(users)) {
        users.forEach(applyAvatarToUser);
        return users;
    }
    return applyAvatarToUser(users);
}

module.exports = {
    DONOR_AVATAR,
    BENEFICIARY_AVATAR,
    GENERIC_AVATAR,
    BENEFICIARY_ROLES,
    STAFF_ROLES,
    hasCustomAvatar,
    isCustomAvatarUrl,
    getDefaultAvatarPath,
    resolveUserAvatar,
    applyAvatarToUser,
    applyAvatarToUsers,
};

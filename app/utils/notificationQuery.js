/**
 * Maps a user role to broadcast notification targetType values.
 */
function getRoleTargetTypes(role) {
    if (role === 'donor') return ['donor'];
    if (['family', 'beneficiary', 'guardian'].includes(role)) return ['family'];
    if (['admin', 'super_admin', 'media', 'regulator', 'support'].includes(role)) return ['admin'];
    return [];
}

/**
 * Date from which broadcast (all/role) notifications apply to this user.
 */
function getNotificationCutoffDate(user) {
    return user.activatedAt || user.createdAt;
}

/**
 * Builds the MongoDB filter for notifications visible to a user.
 * Specific notifications (recipient) are always included.
 * Broadcast notifications are only included if created on/after account activation.
 */
function buildUserNotificationFilter(user, { unreadOnly = false } = {}) {
    const cutoff = getNotificationCutoffDate(user);
    const broadcastTypes = ['all', ...getRoleTargetTypes(user.role)];

    const broadcastFilter = {
        recipient: null,
        targetType: { $in: broadcastTypes },
        createdAt: { $gte: cutoff }
    };

    const specificFilter = { recipient: user._id };

    if (unreadOnly) {
        broadcastFilter.readBy = { $nin: [user._id] };
        specificFilter.isRead = false;
    }

    return { $or: [specificFilter, broadcastFilter] };
}

function formatNotificationForUser(notification, userId) {
    const obj = notification.toObject ? notification.toObject() : { ...notification };
    obj.isReadByMe = notification.recipient
        ? notification.isRead
        : (notification.readBy || []).some(id => id.toString() === userId.toString());
    return obj;
}

module.exports = {
    getRoleTargetTypes,
    getNotificationCutoffDate,
    buildUserNotificationFilter,
    formatNotificationForUser
};

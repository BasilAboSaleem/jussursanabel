const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');

const SUPPORT_ADMIN_ROLES = ['admin', 'super_admin', 'support'];
const FAMILY_ROLES = ['beneficiary', 'family', 'guardian'];
const PUBLIC_REGISTER_ROLES = ['donor', 'beneficiary'];

function parseCookieHeader(header) {
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        cookies[key] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return cookies;
}

function isSupportAdmin(role) {
    return SUPPORT_ADMIN_ROLES.includes(role);
}

function joinAuthorizedRooms(socket, user) {
    const userId = String(user._id);
    socket.join(userId);

    if (user.role) {
        socket.join(user.role);
    }
    if (FAMILY_ROLES.includes(user.role)) {
        socket.join('family');
    }
    if (user.role === 'admin' || user.role === 'super_admin') {
        socket.join('admin');
    }
    if (isSupportAdmin(user.role)) {
        socket.join('support_admins');
    }
}

async function authenticateSocket(socket, next) {
    try {
        const cookies = parseCookieHeader(socket.handshake.headers.cookie);
        const token = cookies.jwt;
        if (!token || token === 'loggedout') {
            return next(new Error('Unauthorized'));
        }

        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id role name status isSoftDeleted');
        if (!user || user.isSoftDeleted || user.status === 'suspended') {
            return next(new Error('Unauthorized'));
        }

        socket.user = user;
        next();
    } catch (err) {
        next(new Error('Unauthorized'));
    }
}

function buildSupportMessagePayload(message, ticket, sender) {
    const isAdminTeam = isSupportAdmin(sender.role);
    return {
        ticketId: String(ticket._id),
        senderId: String(sender._id),
        content: message.content,
        isAdminTeam,
        isAdmin: isAdminTeam,
        senderName: sender.name,
        createdAt: message.createdAt || new Date()
    };
}

function emitSupportMessage(io, { message, ticket, sender }) {
    if (!io || !message || !ticket || !sender) return;

    const payload = buildSupportMessagePayload(message, ticket, sender);
    const ticketUserId = String(ticket.user._id || ticket.user);

    if (payload.isAdminTeam) {
        io.to(ticketUserId).emit('newSupportMessage', payload);
        io.to('support_admins').emit('newSupportMessage', payload);
    } else {
        io.to('support_admins').emit('newSupportMessage', payload);
        io.to(String(sender._id)).emit('newSupportMessage', payload);
    }
}

module.exports = {
    PUBLIC_REGISTER_ROLES,
    SUPPORT_ADMIN_ROLES,
    isSupportAdmin,
    authenticateSocket,
    joinAuthorizedRooms,
    emitSupportMessage
};

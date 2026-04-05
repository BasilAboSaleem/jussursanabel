const jwt = require('jsonwebtoken');
const { promisify } = require('util');
const User = require('../models/User');

// Protect routes
exports.protect = async (req, res, next) => {
    try {
        let token;
        if (req.cookies.jwt) {
            token = req.cookies.jwt;
        }

        if (!token) {
            return res.redirect('/auth/login');
        }

        // Verify token
        const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

        // Check if user still exists
        const currentUser = await User.findById(decoded.id);
        if (!currentUser || currentUser.isSoftDeleted || currentUser.status === 'suspended') {
            res.cookie('jwt', 'loggedout', {
                expires: new Date(Date.now() + 10 * 1000),
                httpOnly: true
            });
            return res.redirect('/auth/login');
        }

        // Grant access
        req.user = currentUser;
        res.locals.user = currentUser;

        // Fetch unread message count
        const Message = require('../models/Message');
        res.locals.unreadCount = await Message.countDocuments({ receiver: currentUser._id, isRead: false });
        
        next();
    } catch (err) {
        return res.redirect('/auth/login');
    }
};

// Check for roles
exports.restrictTo = (...roles) => {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).render('errors/error', {
                title: '403 - غير مصرح',
                message: 'ليس لديك صلاحية للوصول إلى هذه الصفحة.',
                error: {}
            });
        }
        next();
    };
};

// Middleware to block write actions (POST, PUT, PATCH, DELETE) for regulator role
exports.viewOnly = (req, res, next) => {
    // Exempt escalations submission to allow communication with super_admin
    if (req.originalUrl === '/admin/escalations/submit') {
        return next();
    }

    if (req.user.role === 'regulator' && req.method !== 'GET') {
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(403).json({ 
                success: false, 
                error: 'عذراً، دورك إشرافي ورقابي فقط ولا تملك صلاحية للإجراءات الإدارية. لطلب اتخاذ إجراء، يرجى التواصل مع المدير العام عبر غرفة الطوارئ.' 
            });
        }
        req.flash('error', 'عذراً، دورك إشرافي ورقابي فقط ولا تملك صلاحية للإجراءات الإدارية. لطلب اتخاذ إجراء، يرجى التواصل مع المدير العام عبر غرفة الطوارئ.');
        const referer = req.get('Referrer') || req.get('Referer') || '/admin/dashboard';
        return res.redirect(referer);
    }
    next();
};

// Check if user is logged in (for public pages)
exports.isLoggedIn = async (req, res, next) => {
    if (req.cookies.jwt) {
        try {
            const decoded = await promisify(jwt.verify)(req.cookies.jwt, process.env.JWT_SECRET);
            const currentUser = await User.findById(decoded.id);
            if (!currentUser || currentUser.isSoftDeleted || currentUser.status === 'suspended') {
                if (currentUser && (currentUser.isSoftDeleted || currentUser.status === 'suspended')) {
                    res.cookie('jwt', 'loggedout', {
                        expires: new Date(Date.now() + 10 * 1000),
                        httpOnly: true
                    });
                }
                return next();
            }
            
            res.locals.user = currentUser;
            req.user = currentUser;

            // Fetch unread message count
            const Message = require('../models/Message');
            res.locals.unreadCount = await Message.countDocuments({ receiver: currentUser._id, isRead: false });

            return next();
        } catch (err) {
            return next();
        }
    }
    next();
};

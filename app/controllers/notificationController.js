const Notification = require('../models/Notification');
const User = require('../models/User');
const { logActivity } = require('../utils/logger');

exports.createNotification = async (req, res) => {
    try {
        const { title, message, type, targetType, targetUserId, link } = req.body;
        const sender = req.user;

        // Authorization and Validation
        if (!['super_admin', 'admin'].includes(sender.role)) {
            return res.status(403).json({ success: false, error: 'غير مصرح لك بإنشاء إشعارات' });
        }

        // Admin broadcasting to "all" exclude super admins in delivery? The user requested Admins CAN send to Super Admins.
        // We will allow admins to send to specific super admins directly.
        if (sender.role === 'admin' && targetType === 'specific' && targetUserId) {
            // No longer blocking sending to super_admin as per new request.
        }

        const notificationData = {
            sender: sender._id,
            title,
            message,
            type: type || 'info',
            targetType,
            link,
            recipient: targetType === 'specific' ? targetUserId : null
        };

        const notification = await new Notification(notificationData).save();

        const io = req.app.get('io');
        if (io) {
            if (targetType === 'all') {
                if (sender.role === 'super_admin') {
                    io.emit('newNotification', notification);
                } else {
                    // Admin broadcasting to "all" should exclude super admins
                    io.to('admin').to('donor').to('family').emit('newNotification', notification);
                }
            } else if (targetType === 'specific') {
                io.to(targetUserId.toString()).emit('newNotification', notification);
            } else {
                io.to(targetType).emit('newNotification', notification);
            }
        }

        // Log Activity
        logActivity(sender._id, 'NOTIFICATION_SENT', `إرسال إشعار: ${title} إلى ${targetType}`, req);

        res.json({ success: true, notification });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'خطأ في السيرفر' });
    }
};

exports.getUserNotifications = async (req, res) => {
    try {
        const user = req.user;
        
        // Fetch notifications that target this user specifically, or their role, or "all"
        const notifications = await Notification.find({
            $or: [
                { recipient: user._id },
                { targetType: user.role },
                { targetType: 'all' }
            ]
        }).sort({ createdAt: -1 }).limit(50).populate('sender', 'name avatar');

        // Add 'isReadByMe' virtual field
        const formatted = notifications.map(n => {
            const obj = n.toObject();
            obj.isReadByMe = n.recipient ? n.isRead : n.readBy.some(id => id.toString() === user._id.toString());
            return obj;
        });

        // If browser request → render HTML page; if fetch/AJAX → return JSON
        const wantsJSON = req.xhr || req.headers.accept?.includes('application/json');
        if (wantsJSON) {
            return res.json({ success: true, notifications: formatted });
        }

        // Render the notifications history page
        res.render('pages/notifications/index', {
            title: 'مركز الإشعارات',
            user,
            notifications: formatted,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Server Error' });
    }
};

exports.markAsRead = async (req, res) => {
    try {
        const { notificationId } = req.params;
        const userId = req.user._id;

        const notification = await Notification.findById(notificationId);
        if (!notification) return res.status(404).json({ error: 'Notification not found' });

        if (notification.recipient) {
            if (notification.recipient.toString() !== userId.toString()) {
                return res.status(403).json({ error: 'Unauthorized' });
            }
            notification.isRead = true;
        } else {
            if (!notification.readBy.includes(userId)) {
                notification.readBy.push(userId);
            }
        }

        await notification.save();
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

exports.renderNotificationsManager = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const notifications = await Notification.find()
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('sender', 'name');

        const total = await Notification.countDocuments();
        const totalPages = Math.ceil(total / limit);

        res.render('pages/admin/notifications/manage', {
            title: 'إدارة الإشعارات',
            notifications,
            currentPage: page,
            totalPages,
            user: req.user,
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.deleteNotification = async (req, res) => {
    try {
        const notif = await Notification.findById(req.params.id).populate('sender');
        if (!notif) return res.status(404).json({ error: 'Notification not found' });

        // Admin cannot delete super_admin notifications
        if (req.user.role !== 'super_admin' && notif.sender && notif.sender.role === 'super_admin') {
            return res.status(403).json({ error: 'غير مصرح لك بحذف إشعار من إنشاء مدير النظام' });
        }

        await Notification.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server Error' });
    }
};

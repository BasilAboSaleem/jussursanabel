const User = require('../models/User');
const { cloudinary } = require('../utils/cloudinary');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { logActivity } = require('../utils/logger');

exports.getSettings = async (req, res) => {
    try {
        res.render('pages/profile/settings', {
            title: res.__('profile_settings_title'),
            user: req.user
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.updateProfile = async (req, res) => {
    try {
        const { name, idNumber, phone } = req.body;
        const userId = req.user._id;

        let updateData = { name, idNumber, phone };

        // Phase 8: Admin Branding Lockdown
        const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
        
        if (isAdmin) {
            // Enforce unified admin avatar
            updateData.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(req.user.role === 'super_admin' ? 'Super Admin' : 'Admin')}&background=020617&color=D4AF37&bold=true&size=512`;
            // Cleanup any mistakenly uploaded file
            if (req.file) fs.unlinkSync(req.file.path);
        } else if (req.file) {
            // Beneficiaries / Donors can update their avatar
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'jussur-sanabel/avatars'
            });
            updateData.avatar = result.secure_url;
            fs.unlinkSync(req.file.path);
        }

        const user = await User.findByIdAndUpdate(userId, updateData, { new: true });
        
        // Log the activity
        await logActivity(userId, 'profile_update', 'User', userId, 
            `تم تحديث بيانات الملف الشخصي (الحقول المعدلة: ${Object.keys(updateData).join(', ')})`);

        req.flash('success', res.__('flash_profile_updated'));
        res.redirect('/profile/settings');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_profile_error'));
        res.redirect('/profile/settings');
    }
};

exports.updatePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        const user = await User.findById(req.user._id);

        if (!(await user.comparePassword(currentPassword))) {
            req.flash('error', res.__('flash_password_wrong'));
            return res.redirect('/profile/settings');
        }

        if (newPassword !== confirmPassword) {
            req.flash('error', res.__('flash_password_mismatch'));
            return res.redirect('/profile/settings');
        }

        user.password = newPassword;
        await user.save();

        // Log the activity
        await logActivity(req.user._id, 'profile_update', 'User', req.user._id, 'تم تغيير كلمة المرور بنجاح للحساب');

        req.flash('success', res.__('flash_password_updated'));
        res.redirect('/profile/settings');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_password_error'));
        res.redirect('/profile/settings');
    }
};

exports.saveChatWindow = async (req, res) => {
    try {
        const { from, to } = req.body;
        const donorId = req.user._id;

        if (!from || !to) {
            return res.status(400).json({ success: false, error: res.__('error_chat_window_times') });
        }

        // Validate: from < to
        const [fH, fM] = from.split(':').map(Number);
        const [tH, tM] = to.split(':').map(Number);
        if (fH * 60 + fM >= tH * 60 + tM) {
            return res.status(400).json({ success: false, error: res.__('error_chat_window_order') });
        }

        await User.findByIdAndUpdate(donorId, { chatWindow: { from, to } });

        // Notify all families with approved chat requests from this donor
        const ChatRequest = require('../models/ChatRequest');
        const Notification = require('../models/Notification');
        const Setting = require('../models/Setting');
        const { DAY_NAMES_AR } = require('../utils/chatUtils');

        const chatDayConfig = await Setting.findOne({ key: 'chat_day' });
        const chatDay = chatDayConfig ? Number(chatDayConfig.value) : 5;
        const dayName = DAY_NAMES_AR[chatDay];

        const approvedRequests = await ChatRequest.find({
            donor: donorId,
            status: 'approved'
        });

        const familyIds = [...new Set(approvedRequests.map(r => r.family.toString()))];

        for (const familyId of familyIds) {
            await Notification.create({
                sender: donorId,
                recipient: familyId,
                title: res.__('notif_chat_window_title', { name: req.user.name }),
                message: res.__('notif_chat_window_msg', { name: req.user.name, day: dayName, from, to }),
                type: 'info',
                targetType: 'specific',
                link: `/messages/${donorId}`
            });
        }

        // Also send realtime notifications via socket.io if io is available
        const io = req.app && req.app.get ? req.app.get('io') : null;
        if (io) {
            const donor = await User.findById(donorId);
            for (const familyId of familyIds) {
                io.to(familyId).emit('newNotification', {
                    title: `المتبرع ${donor ? donor.name : ''} حدّد موعد التواصل`,
                    message: `سيكون المتبرع ${donor ? donor.name : ''} متاحاً للتواصل غداً يوم ${dayName} من ${from} حتى ${to}.`,
                    type: 'info',
                    link: `/messages/${donorId}`
                });
            }
        }

        // Log the activity
        const { logActivity } = require('../utils/logger');
        await logActivity(donorId, 'DONOR_WINDOW_UPDATE', `تحديث وقت التواصل: ${from} - ${to}`, req);

        return res.json({ success: true, message: res.__('flash_chat_window_saved', { from, to }) });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: res.__('flash_chat_window_error') });
    }
};

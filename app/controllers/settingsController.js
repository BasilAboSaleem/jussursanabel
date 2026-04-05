const Setting = require('../models/Setting');
const Notification = require('../models/Notification');
const { DAY_NAMES_AR } = require('../utils/chatUtils');

exports.getSettings = async (req, res) => {
    try {
        let institutionPercentage = await Setting.findOne({ key: 'institution_fee_percentage' });
        let gatewayPercentage = await Setting.findOne({ key: 'gateway_fee_percentage' });
        let caseNeedsConfig = await Setting.findOne({ key: 'case_needs' });
        let chatDayConfig = await Setting.findOne({ key: 'chat_day' });
        
        if (!institutionPercentage) {
            institutionPercentage = await Setting.create({ 
                key: 'institution_fee_percentage', 
                value: 0, 
                description: 'رصيد المؤسسة من رسوم التشغيل (%)' 
            });
        }
        if (!gatewayPercentage) {
            gatewayPercentage = await Setting.create({ 
                key: 'gateway_fee_percentage', 
                value: 0, 
                description: 'رسوم بوابة الدفع الإلكترونية (%)' 
            });
        }

        if (!caseNeedsConfig) {
            caseNeedsConfig = await Setting.create({ 
                key: 'case_needs', 
                value: 'مساعدة مالية,إيواء,علاج صحي,كفالة,أخرى', 
                description: 'خيارات الاحتياج المتاحة للمستفيدين عند تسجيل الحالة (مفصولة بفاصلة)' 
            });
        }

        if (!chatDayConfig) {
            chatDayConfig = await Setting.create({ 
                key: 'chat_day', 
                value: 5,
                description: 'رقم اليوم المسموح فيه بالتواصل (0=الأحد, 5=الجمعة, 6=السبت)'
            });
        }

        res.render('pages/admin/settings', {
            title: res.__('admin_settings_title'),
            settings: {
                institution_fee_percentage: institutionPercentage.value,
                gateway_fee_percentage: gatewayPercentage.value,
                case_needs: caseNeedsConfig.value,
                chat_day: chatDayConfig.value
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const { institution_fee_percentage, gateway_fee_percentage, case_needs, chat_day } = req.body;
        
        // 1. Get old settings for comparison and logging
        const oldChatDayConfig = await Setting.findOne({ key: 'chat_day' });
        const oldDay = oldChatDayConfig ? Number(oldChatDayConfig.value) : null;
        const newDay = Number(chat_day);

        // 2. Update Split Fees
        await Setting.findOneAndUpdate(
            { key: 'institution_fee_percentage' },
            { value: Number(institution_fee_percentage || 0), updatedAt: new Date() },
            { upsert: true }
        );
        await Setting.findOneAndUpdate(
            { key: 'gateway_fee_percentage' },
            { value: Number(gateway_fee_percentage || 0), updatedAt: new Date() },
            { upsert: true }
        );

        // Also update the legacy total field for backward compatibility where used
        const totalPercentage = Number(institution_fee_percentage || 0) + Number(gateway_fee_percentage || 0);
        await Setting.findOneAndUpdate(
            { key: 'operation_percentage' },
            { value: totalPercentage, updatedAt: new Date() }
        );

        // 3. Update Case Needs
        if (case_needs !== undefined) {
             await Setting.findOneAndUpdate(
                 { key: 'case_needs' },
                 { value: case_needs, updatedAt: new Date() },
                 { upsert: true }
             );
        }

        // 4. Update Chat Day & Notify All if changed
        if (chat_day !== undefined) {
            await Setting.findOneAndUpdate(
                { key: 'chat_day' },
                { value: newDay, updatedAt: new Date() },
                { upsert: true }
            );

            if (oldDay !== newDay) {
                const dayName = DAY_NAMES_AR[newDay];
                // Create Global Notification
                const globalNotif = await Notification.create({
                    sender: req.user._id,
                    title: res.__('notif_chat_day_updated_title'),
                    message: res.__('notif_chat_day_updated_msg', { day: dayName }),
                    type: 'info',
                    targetType: 'all',
                    link: '/messages'
                });

                // Real-time broadcast if IO is available
                const io = req.app.get('io');
                if (io) {
                    io.emit('newGlobalNotification', {
                        title: globalNotif.title,
                        message: globalNotif.message,
                        type: globalNotif.type,
                        link: globalNotif.link
                    });
                }
            }
        }

        const { logActivity } = require('../utils/logger');
        await logActivity(req.user._id, 'settings_update', 'Settings', null, 
            `تحديث إعدادات النظام: مجموع الرسوم ${totalPercentage}% (${institution_fee_percentage}% مؤسسة + ${gateway_fee_percentage}% بوابة)، يوم التواصل ${newDay}`,
            { oldDay, newDay, institution_fee_percentage, gateway_fee_percentage });

        req.flash('success', res.__('flash_settings_updated'));
        res.redirect('/admin/settings');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_settings_error'));
        res.redirect('/admin/settings');
    }
};

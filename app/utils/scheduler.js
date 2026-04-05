const Setting = require('../models/Setting');
const Notification = require('../models/Notification');
const User = require('../models/User');
const ChatRequest = require('../models/ChatRequest');
const { DAY_NAMES_AR } = require('./chatUtils');


/**
 * Checks if reminders should be sent today for "tomorrow's" chat day.
 */
async function checkAndSendReminders(io) {
    try {
        const now = new Date();
        const todayStr = now.toDateString();

        // --- Persistence Lock ---
        // Step 1: Try to update an existing record (only if value != today).
        const claim = await Setting.updateOne(
            { key: 'last_reminder_date', value: { $ne: todayStr } },
            { $set: { value: todayStr, updatedAt: new Date() } }
            // NO upsert here — avoids E11000 when the doc exists but already has today's value
        );

        if (claim.matchedCount === 0) {
            // The doc either doesn't exist yet, or it already has today's value.
            const existing = await Setting.findOne({ key: 'last_reminder_date' });
            if (existing) {
                // Doc exists with todayStr → already claimed, nothing to do.
                return;
            }
            // Doc doesn't exist yet → create it for the first time.
            try {
                await Setting.create({ key: 'last_reminder_date', value: todayStr });
            } catch (e) {
                if (e.code === 11000) return; // Race condition: another instance created it first.
                throw e;
            }
        }
        // ----------------------

        const chatDayConfig = await Setting.findOne({ key: 'chat_day' });
        if (!chatDayConfig) return;

        const chatDay = Number(chatDayConfig.value); // 0-6
        const tomorrow = new Date();
        tomorrow.setDate(now.getDate() + 1);
        const tomorrowDay = tomorrow.getDay(); // 0-6

        if (tomorrowDay === chatDay) {
            console.log(`[Scheduler] Tomorrow is Chat Day (${DAY_NAMES_AR[chatDay]}). Sending reminders...`);
            
            // 1. Send Generic Global Reminder
            const globalNotif = await Notification.create({
                sender: (await User.findOne({ role: 'super_admin' }))?._id || (await User.findOne({ role: 'admin' }))?._id,
                title: 'تذكير: موعد التواصل غداً',
                message: `نود تذكيركم بأن غداً ${DAY_NAMES_AR[chatDay]} هو اليوم المخصص للتواصل. يُرجى التواجد في الموعد المحدد.`,
                type: 'info',
                targetType: 'all',
                link: '/messages'
            });

            if (io) {
                io.emit('newGlobalNotification', {
                    title: globalNotif.title,
                    message: globalNotif.message,
                    type: globalNotif.type,
                    link: globalNotif.link
                });
            }

            // 2. Send Targeted Reminders to families with approved requests
            const approvedRequests = await ChatRequest.find({ status: 'approved' })
                .populate('donor family');

            const notifiedPairs = new Set();

            for (const req of approvedRequests) {
                if (!req.donor || !req.family) continue;
                const donor = req.donor;
                const family = req.family;
                const pairId = `${donor._id}_${family._id}`;

                if (notifiedPairs.has(pairId)) continue;

                const window = donor.chatWindow;
                if (window && window.from && window.to) {
                    await Notification.create({
                        sender: donor._id,
                        recipient: family._id,
                        title: 'تذكير: تواصل غداً مع المتبرع',
                        message: `تذكير: المتبرع ${donor.name} سيكون متاحاً للتواصل معك غداً من الساعة ${window.from} حتى ${window.to}.`,
                        type: 'info',
                        targetType: 'specific',
                        link: `/messages/${donor._id}`
                    });

                    if (io) {
                        io.to(family._id.toString()).emit('newNotification', {
                            title: 'تذكير: تواصل غداً',
                            message: `سيكون المتبرع ${donor.name} متاحاً غداً من ${window.from} إلى ${window.to}.`,
                            type: 'info',
                            link: `/messages/${donor._id}`
                        });
                    }
                    notifiedPairs.add(pairId);
                }
            }


            console.log('[Scheduler] Reminders sent successfully.');
        }
    } catch (err) {
        console.error('[Scheduler Error]', err);
    }
}

/**
 * Starts the scheduler loop.
 */
exports.startScheduler = (app) => {
    // Phase: Cluster mode optimization
    // PM2 sets NODE_APP_INSTANCE (0, 1, 2...). We only want the primary instance (0) 
    // to run the scheduling loop to save resources and prevent duplicate checks.
    if (process.env.NODE_APP_INSTANCE && process.env.NODE_APP_INSTANCE !== '0') {
        console.log(`[Scheduler] Cluster Mode: Instance ${process.env.NODE_APP_INSTANCE} skipping scheduler loop.`);
        return;
    }

    const io = app.get('io');
    // Run initial check on startup
    checkAndSendReminders(io);
    
    // Check every 1 hour (3600000ms)
    // We adjust it for testing if needed, but 1 hour is fine for daily reminders.
    setInterval(() => checkAndSendReminders(io), 3600000);
    console.log('⏰ Chat Scheduler loop started (hourly checks).');
};

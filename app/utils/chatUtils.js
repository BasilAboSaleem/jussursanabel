/**
 * Chat Day / Window Enforcement Utilities
 */
const Setting = require('../models/Setting');

/**
 * Returns the currently configured chat day (0=Sun … 6=Sat) from DB.
 */
async function getChatDay() {
    const config = await Setting.findOne({ key: 'chat_day' });
    return config ? Number(config.value) : 5; // default Friday
}

/**
 * Day names for Arabic display.
 */
const DAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/**
 * Checks whether NOW falls within the allowed chat window.
 * @param {number} chatDay   - Allowed day (0–6) from Settings.
 * @param {object} donor     - Mongoose User doc with chatWindow.from / chatWindow.to
 * @returns {{ allowed: boolean, reason?: string, dayName: string }}
 */
function isChatAllowed(chatDay, donor) {
    const now = new Date();
    const todayDay = now.getDay(); // 0=Sun … 6=Sat
    const dayName = DAY_NAMES_AR[chatDay];

    if (todayDay !== chatDay) {
        return {
            allowed: false,
            reason: `التواصل المباشر متاح فقط يوم ${dayName} من كل أسبوع. نشكرك على تفهمك.`,
            dayName
        };
    }

    // Check donor time window (only if donor has set one)
    if (donor && donor.chatWindow && donor.chatWindow.from && donor.chatWindow.to) {
        const [fromH, fromM] = donor.chatWindow.from.split(':').map(Number);
        const [toH, toM]   = donor.chatWindow.to.split(':').map(Number);

        const nowMins  = now.getHours() * 60 + now.getMinutes();
        const fromMins = fromH * 60 + fromM;
        const toMins   = toH   * 60 + toM;

        if (nowMins < fromMins || nowMins > toMins) {
            return {
                allowed: false,
                reason: `نافذة التواصل ليوم ${dayName} هي من ${donor.chatWindow.from} إلى ${donor.chatWindow.to}. الرجاء الإرسال خلال هذا الوقت.`,
                dayName
            };
        }
    }

    return { allowed: true, dayName };
}

module.exports = { getChatDay, isChatAllowed, DAY_NAMES_AR };

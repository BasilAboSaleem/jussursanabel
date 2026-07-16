/**
 * Shared chat-day countdown — mirrors server isChatAllowed() logic (local clock).
 */
(function (global) {
    const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

    function parseChatDay(value) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const n = Number(value);
        if (!Number.isNaN(n) && n >= 0 && n <= 6) return n;
        const idx = days.indexOf(String(value));
        return idx >= 0 ? idx : 5;
    }

    function parseTimeToMins(timeStr, fallback) {
        const t = timeStr || fallback;
        const parts = t.split(':').map(Number);
        return parts[0] * 60 + (parts[1] || 0);
    }

    function getNextWindow(chatDayIndex, windowFrom, windowTo, now) {
        now = now || new Date();
        const fromMins = parseTimeToMins(windowFrom, '09:00');
        const toMins = parseTimeToMins(windowTo, '17:00');
        const nowMins = now.getHours() * 60 + now.getMinutes();

        if (now.getDay() === chatDayIndex) {
            if (nowMins >= fromMins && nowMins <= toMins) {
                return { state: 'open', nextDate: null, fromMins, toMins };
            }
            if (nowMins < fromMins) {
                const next = new Date(now);
                next.setHours(Math.floor(fromMins / 60), fromMins % 60, 0, 0);
                return { state: 'waiting', nextDate: next, fromMins, toMins };
            }
        }

        let daysUntil = (chatDayIndex - now.getDay() + 7) % 7;
        if (daysUntil === 0) daysUntil = 7;

        const next = new Date(now);
        next.setDate(now.getDate() + daysUntil);
        next.setHours(Math.floor(fromMins / 60), fromMins % 60, 0, 0);
        return { state: 'waiting', nextDate: next, fromMins, toMins };
    }

    function formatCountdown(diff) {
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        const pad = function (n) { return n < 10 ? '0' + n : String(n); };
        const timeStr = pad(h) + ' : ' + pad(m) + ' : ' + pad(s);
        return d > 0
            ? '<span style="font-size:1.2rem;">' + d + ' أيام و </span>' + timeStr
            : timeStr;
    }

    function init(options) {
        const chatDayIndex = parseChatDay(options.chatDay);
        const displayEl = document.getElementById(options.displayId);
        const subEl = options.subLabelSelector
            ? document.querySelector(options.subLabelSelector)
            : null;
        const windowFrom = options.windowFrom || '09:00';
        const windowTo = options.windowTo || '17:00';
        const openHtml = options.openHtml || '<span style="color:#00A544;"><i class="fa-solid fa-circle-dot"></i> الباب مفتوح الآن للتواصل</span>';
        const serverTzLabel = options.serverTzLabel || '';
        const dayLabelPrefix = options.dayLabelPrefix || 'يوم التواصل';

        function tick() {
            if (!displayEl) return;
            const result = getNextWindow(chatDayIndex, windowFrom, windowTo);
            if (subEl) {
                let sub = dayLabelPrefix + ': <strong>' + DAYS_AR[chatDayIndex] + '</strong> · ' + windowFrom + '–' + windowTo;
                if (serverTzLabel) sub += ' · ' + serverTzLabel;
                subEl.innerHTML = sub;
            }
            if (result.state === 'open') {
                displayEl.innerHTML = openHtml;
                return;
            }
            const diff = result.nextDate - new Date();
            if (diff <= 0) {
                displayEl.textContent = '...';
                return;
            }
            displayEl.innerHTML = formatCountdown(diff);
        }

        tick();
        setInterval(tick, 1000);
    }

    global.NmChatCountdown = { init: init, parseChatDay: parseChatDay, DAYS_AR: DAYS_AR };
})(typeof window !== 'undefined' ? window : global);

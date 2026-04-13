require("dotenv").config();

/**
 * Android/WebView يحمّل الموقع من الخادم (Express) عبر server.url.
 * - محاكي Android: http://10.0.2.2:PORT (الوصول لجهازك من المحاكي)
 * - جهاز حقيقي على نفس الشبكة: http://YOUR_LAN_IP:PORT
 * - إنتاج: https://your-domain.com
 */
const port = process.env.PORT || "3000";
/** يعمل على محاكي Android فقط — على هاتف حقيقي استخدم IP الشبكة (انظر رسالة السيرفر عند التشغيل). */
const defaultDev = `http://10.0.2.2:${port}`;
const serverUrl = process.env.CAPACITOR_SERVER_URL || defaultDev;
if (!process.env.CAPACITOR_SERVER_URL) {
  console.warn(
    "[Capacitor] CAPACITOR_SERVER_URL غير مضبوط → استخدام 10.0.2.2 (محاكي فقط). للهاتف: عيّن IP الكمبيوتر على الـ Wi‑Fi."
  );
}

module.exports = {
  appId: "com.jussursanabel.app",
  appName: "Jussur Sanabel",
  webDir: "capacitor/www",
  server: {
    url: serverUrl,
    cleartext: true,
  },
};

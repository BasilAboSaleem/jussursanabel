const rateLimit = require('express-rate-limit');

// حماية مسارات تسجيل الدخول وإنشاء الحسابات (منع التخمين)
// [TEMPORARY DISABLE FOR DEVELOPMENT] - Max increased to 10k to prevent blockage during testing
// TODO: Reset max to 5-10 before production deployment
exports.authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // ساعة واحدة
    max: 10000, // الحد الأقصى 10000 محاولة لكل IP (معطل فعلياً للتطوير)
    message: 'تم إيقاف محاولات تسجيل الدخول مؤقتاً لحماية النظام، يرجى المحاولة بعد ساعة.',
    standardHeaders: true, 
    legacyHeaders: false, 
});

// حماية مسارات الدفع والتبرع (الحد من الاحتيال)
exports.paymentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // ساعة واحدة
    max: 20, // الحد الأقصى 20 محاولة لكل IP
    message: 'تم تجاوز عدد محاولات الدفع المسموحة لحماية البطاقات. يرجى المحاولة لاحقاً.',
    standardHeaders: true,
    legacyHeaders: false,
});

// حماية عامة لباقي مسارات النظام (الحد من ضغط الـ DDoS)
exports.apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 دقيقة
    max: 1000, // الحد الأقصى 1000 طلب
    message: 'هناك ضغط كبير على النظام، يرجى المحاولة بعد قليل.',
    standardHeaders: true,
    legacyHeaders: false,
});

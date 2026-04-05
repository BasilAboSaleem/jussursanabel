exports.welcomeEmail = (name) => {
    return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: right; color: #333; line-height: 1.6; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
        <h2 style="color: #2c3e50;">مرحباً بك في جسور سنابل يا ${name}! 🌟</h2>
        <p>نحن سعداء جداً بانضمامك إلى منصة جسور سنابل لدعم الأيتام والأسر في غزة.</p>
        <p>يمكنك الآن تصفح الحالات والمساهمة في زرع الأمل والتغيير الإيجابي.</p>
        <br>
        <p>مع خالص التحيات،<br><strong>فريق جسور سنابل</strong></p>
    </div>
    `;
};

exports.donationReceipt = (name, amount, caseName) => {
    return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: right; color: #333; line-height: 1.6; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
        <h2 style="color: #27ae60;">شكراً لك يا ${name} على تبرعك السخي! 💖</h2>
        <p>لقد استلمنا بنجاح تبرعك بقيمة <strong style="color: #e74c3c;">$${amount}</strong> لصالح: <strong>${caseName}</strong>.</p>
        <p>مساهمتك تعني الكثير وتحدث فارقاً حقيقياً في حياة من هم بأمس الحاجة.</p>
        <br>
        <p>في المرفقات أو عبر حسابك يمكنك تتبع حالة مساهمتك دائماً.</p>
        <br>
        <p>مع خالص التقدير وافر الامتنان،<br><strong>فريق جسور سنابل</strong></p>
    </div>
    `;
};

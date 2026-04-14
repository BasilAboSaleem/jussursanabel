const signature = `
    <br>
    <p style="border-top: 1px solid #eee; padding-top: 15px; font-size: 0.85rem; color: #777;">
        مع خالص المودة والتقدير،<br>
        <strong>فريق منصة سُبُل</strong><br>
        <span style="font-size: 0.75rem;">إحدى منصات مؤسسة السنابل للشباب والتنمية</span>
    </p>`;

exports.welcomeEmail = (name) => {
    return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: right; color: #333; line-height: 1.6; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
        <h2 style="color: #0A2540;">مرحباً بك في سُبُل يا ${name}! 🌟</h2>
        <p>نحن سعداء جداً بانضمامك إلى <strong>منصة سُبُل</strong>، المنصة الرقمية الموحدة التابعة لمؤسسة السنابل للشباب والتنمية لدعم أهلنا في غزة.</p>
        <p>عبر حسابك الآن، يمكنك المساهمة مباشرة في الكفالات والتدخلات الإنسانية وتتبع أثر عطائك بكل شفافية.</p>
        ${signature}
    </div>
    `;
};

exports.donationReceipt = (name, amount, caseName) => {
    return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: right; color: #333; line-height: 1.6; padding: 20px; background-color: #f9f9f9; border-radius: 8px;">
        <h2 style="color: #10B981;">شكراً لك يا ${name} على تبرعك السخي! 💖</h2>
        <p>لقد استلمنا بنجاح تبرعك بقيمة <strong style="color: #0A2540;">$${amount}</strong> لصالح حالة: <strong>${caseName}</strong>.</p>
        <p>مساهمتك الكريمة عبر "سُبُل" تصل مباشرة لمستحقيها بفضل الله ثم بجهود فرق مؤسسة السنابل في الميدان.</p>
        <p>يمكنك دائماً مراجعة تفاصيل المعاملة وتقارير الحالة عبر لوحة التحكم الخاصة بك.</p>
        ${signature}
    </div>
    `;
};

exports.contactFormEmail = (name, email, subject, message) => {
    return `
    <div dir="rtl" style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: right; color: #333; line-height: 1.6; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
        <h2 style="color: #0A2540; border-bottom: 2px solid #10B981; padding-bottom: 10px;">رسالة جديدة من منصة سُبُل</h2>
        <p><strong>من:</strong> ${name} (&lt;${email}&gt;)</p>
        <p><strong>الموضوع:</strong> ${subject}</p>
        <div style="background: #f8fafc; padding: 15px; border-radius: 6px; margin: 15px 0;">
            <p style="white-space: pre-line;">${message}</p>
        </div>
        <p style="font-size: 0.8rem; color: #999;">تم إرسال هذه الرسالة عبر نموذج "اتصل بنا" في موقع سُبُل الرسمي.</p>
    </div>
    `;
};

const nodemailer = require('nodemailer');
const { enqueueEmail } = require('./queue');

const sendEmail = async (options) => {
    try {
        const mailOptions = {
            from: `منصة سُبُل <${process.env.EMAIL_FROM || 'pal-gaza@senabilcharity.org'}>`,
            to: options.email,
            subject: options.subject,
            html: options.html
        };

        // If queue is available, offload sending to worker for better throughput.
        const queued = await enqueueEmail(mailOptions);
        if (queued) {
            console.log(`Email queued for ${options.email}`);
            return;
        }

        let transporter;
        if (process.env.EMAIL_USERNAME && process.env.EMAIL_PASSWORD) {
            const port = parseInt(process.env.EMAIL_PORT, 10) || 465;
            // secure: true for port 465, false for other ports (like 587 for Outlook/Gmail STARTTLS)
            const isSecure = port === 465;

            transporter = nodemailer.createTransport({
                host: process.env.EMAIL_HOST || 'smtp-mail.outlook.com',
                port: port,
                secure: isSecure,
                auth: {
                    user: process.env.EMAIL_USERNAME,
                    pass: process.env.EMAIL_PASSWORD
                },
                // Recommended for modern Node environments to avoid handshake issues on some servers
                tls: {
                    rejectUnauthorized: false
                }
            });
        } else {
            // إنشاء بريد اختباري مجاني تلقائياً في بيئة التطوير
            const testAccount = await nodemailer.createTestAccount();
            transporter = nodemailer.createTransport({
                host: 'smtp.ethereal.email',
                port: 587,
                secure: false,
                auth: {
                    user: testAccount.user,
                    pass: testAccount.pass
                }
            });
        }

        const info = await transporter.sendMail(mailOptions);
        
        if (!process.env.EMAIL_USERNAME) {
            console.log('----------------------------------------------------');
            console.log('✉️ رسالة الترحيب المتجهة لـ ' + options.email + ' تم إرسالها بنجاح!');
            console.log('👀 يمكنك معاينتها كما ستصل للمستخدم عبر الرابط التالي:');
            console.log('📎 ' + nodemailer.getTestMessageUrl(info));
            console.log('----------------------------------------------------');
        } else {
            console.log(`Email sent successfully to ${options.email}`);
        }

    } catch (error) {
        console.error('Error sending email:', error);
    }
};

module.exports = sendEmail;

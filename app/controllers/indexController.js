const Case = require('../models/Case');
const Testimonial = require('../models/Testimonial');
const { prepareStoryVideoAsync } = require('../utils/storyVideo');
const { PUBLIC_CASE_STATUSES } = require('../utils/caseSatisfaction');

exports.getHomepage = async (req, res) => {
    try {
        const casesLimit = Number(process.env.HOMEPAGE_CASES_LIMIT || 8);
        const testimonialsLimit = Number(process.env.HOMEPAGE_TESTIMONIALS_LIMIT || 12);

        const [cases, testimonials] = await Promise.all([
            Case.find({
                status: { $in: PUBLIC_CASE_STATUSES },
                isHidden: { $ne: true },
                storyVideo: { $exists: true, $ne: '' }
            })
                .select('title type description image raisedAmount targetAmount storyVideo createdAt')
                .sort({ createdAt: -1 })
                .limit(casesLimit)
                .lean(),
            Testimonial.find({ status: 'approved' })
                .select('content user locationAr rating createdAt')
                .populate('user', 'name avatar')
                .sort({ createdAt: -1 })
                .limit(testimonialsLimit)
                .lean()
        ]);

        const isEn = req.getLocale() === 'en';

        const demoCases = cases.length > 0 ? cases : (isEn ? [
            {
                _id: '1',
                title: 'Orphan sponsorship — Martyr Muhammad\'s family',
                type: 'orphan',
                description: 'Four children who lost their sole provider urgently need education and basic living support.',
                image: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=2070&auto=format&fit=crop',
                raisedAmount: 450,
                targetAmount: 1200
            },
            {
                _id: '2',
                title: 'Support for Umm Omar\'s family',
                type: 'family',
                description: 'A family of seven living in a tent lacking the basics of a dignified life.',
                image: 'https://images.unsplash.com/photo-1542810634-71277d95dcbb?q=80&w=2070&auto=format&fit=crop',
                raisedAmount: 780,
                targetAmount: 1500
            }
        ] : [
            {
                _id: '1',
                title: 'كفالة تعليمية لأيتام أسرة محتاجة',
                type: 'orphan',
                description: 'أربعة أطفال فقدوا معيلهم الوحيد وبحاجة ماسة لمصاريف التعليم والمعيشة الأساسية.',
                image: 'https://images.unsplash.com/photo-1488521787991-ed7bbaae773c?q=80&w=2070&auto=format&fit=crop',
                raisedAmount: 450,
                targetAmount: 1200
            },
            {
                _id: '2',
                title: 'دعم احتياجات أسرة أم عمر',
                type: 'family',
                description: 'عائلة مكونة من 7 أفراد تسكن في خيمة تفتقر لأدنى مقومات الحياة الكريمة.',
                image: 'https://images.unsplash.com/photo-1542810634-71277d95dcbb?q=80&w=2070&auto=format&fit=crop',
                raisedAmount: 780,
                targetAmount: 1500
            }
        ]);

        const preparedCases = await Promise.all(demoCases.map(async (item) => {
            const plain = typeof item.toObject === 'function' ? item.toObject() : item;
            return {
                ...plain,
                ...(await prepareStoryVideoAsync(plain.storyVideo || '', { youtubeMuted: 1 }))
            };
        }));

        const defaultTestimonials = isEn ? [
            {
                content: 'What I love most about Nameer is the absolute transparency — I felt as if I were in Gaza placing charity directly in the hands of those in need.',
                user: { name: 'Khaled Abdullah' },
                locationAr: 'Donor from Jordan',
                rating: 5
            },
            {
                content: 'I have sponsored an orphan through this platform for two years. Regular reports and conversations showed me the real impact of my giving.',
                user: { name: 'Sarah Al-Mansouri' },
                locationAr: 'Donor from UAE',
                rating: 5
            },
            {
                content: 'Direct connection is the real innovation here. Dignity is preserved for recipients and peace of mind for donors.',
                user: { name: 'Dr. Ahmed Khalil' },
                locationAr: 'Philanthropist from Qatar',
                rating: 5
            }
        ] : [
            {
                content: 'أجمل ما في نَمير هو الشفافية المطلقة.. شعرت كأنني في غزة أضع الصدقة في يد المحتاج بنفسي.',
                user: { name: 'خالد عبد الله' },
                locationAr: 'متبرع من الأردن',
                rating: 5
            },
            {
                content: 'منذ سنتين أكفل يتيماً عبر هذه المنصة، والتقارير الدورية والمحادثات جعلتني أشعر بمدى الفرق الذي يحدثه عطائي.',
                user: { name: 'سارة المنصوري' },
                locationAr: 'متبرعة من الإمارات',
                rating: 5
            },
            {
                content: 'الربط المباشر هو الابتكار الحقيقي هنا. الكرامة محفوظة للفقير والطمأنينة مضمونة للمتصدق.',
                user: { name: 'د. أحمد خليل' },
                locationAr: 'فاعل خير من قطر',
                rating: 5
            }
        ];

        res.render('pages/index', {
            title: res.__('home'),
            cases: preparedCases,
            testimonials: testimonials.length > 0 ? testimonials : defaultTestimonials,
            fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getAbout = (req, res) => {
    res.render('pages/about', { 
        title: res.__('about_us_title'),
        fullUrl: `${req.protocol}://${req.get('host')}/about`
    });
};

exports.getContact = (req, res) => {
    res.render('pages/contact', { 
        title: res.__('contact_us'),
        fullUrl: `${req.protocol}://${req.get('host')}/contact`
    });
};

exports.postContact = async (req, res) => {
    const { name, email, subject, message } = req.body;
    
    // Simple validation
    if (!name || !email || !message) {
        req.flash('error', 'يرجى ملء جميع الحقول المطلوبة.');
        return res.redirect('/contact');
    }

    try {
        const sendEmail = require('../utils/emailSender');
        const { contactFormEmail } = require('../utils/emailTemplates');
        
        // Send email to foundation
        const emailResult = await sendEmail({
            email: process.env.EMAIL_USERNAME || process.env.EMAIL_FROM || 'pal-gaza@senabilcharity.org',
            subject: `رسالة تواصل جديدة: ${subject || 'بدون عنوان'}`,
            html: contactFormEmail(name, email, subject || 'بدون عنوان', message),
            type: 'contact_form'
        });

        if (!emailResult.ok) {
            req.flash('error', 'نعتذر، تعذّر إرسال الرسالة حالياً. يرجى المحاولة لاحقاً أو التواصل عبر القنوات الأخرى.');
            return res.redirect('/contact');
        }

        req.flash('success', 'شكراً لك! تم استلام رسالتك وسيتواصل معك فريقنا في أقرب وقت ممكن.');
        res.redirect('/contact');
    } catch (err) {
        console.error('Contact Form Error:', err);
        req.flash('error', 'نعتذر، حدث خطأ أثناء إرسال الرسالة. يرجى المحاولة مرة أخرى لاحقاً.');
        res.redirect('/contact');
    }
};

exports.getTransparency = (req, res) => {
    res.render('pages/transparency', { 
        title: res.__('navbar_transparency'),
        fullUrl: `${req.protocol}://${req.get('host')}/transparency`
    });
};

const STORIES_FEED_FILTER = {
    status: { $in: PUBLIC_CASE_STATUSES },
    isHidden: { $ne: true },
    isStoryHidden: { $ne: true },
    storyVideo: { $exists: true, $ne: '' }
};

async function formatStoryForClient(story, { youtubeMuted = 0 } = {}) {
    const videoMeta = await prepareStoryVideoAsync(story.storyVideo || '', { youtubeMuted });
    if (!videoMeta.storyVideoPlayable) return null;

    const targetAmount = Number(story.targetAmount) || 0;
    const raisedAmount = Number(story.raisedAmount) || 0;
    const pct = targetAmount ? Math.min(Math.round((raisedAmount / targetAmount) * 100), 100) : 0;

    return {
        _id: story._id,
        title: story.title,
        description: story.description || '',
        type: story.type,
        image: story.image || '',
        provider: videoMeta.storyVideoProvider,
        isEmbeddable: videoMeta.storyVideoIsEmbeddable,
        embedUrl: videoMeta.storyVideoEmbedUrl || '',
        playableUrl: videoMeta.storyVideoIsEmbeddable ? '' : videoMeta.storyVideoPlayable,
        raisedAmount,
        targetAmount,
        pct,
        isUrgent: pct < 30,
        supporterCount: Math.max(1, Math.floor(raisedAmount / (Number(story.monthlySponsorshipAmount) || 100)))
    };
}

exports.getStoriesHub = async (req, res) => {
    try {
        const total = await Case.countDocuments(STORIES_FEED_FILTER);

        res.render('pages/stories', {
            title: 'قصص سنابل - Stories',
            storiesTotal: total,
            initialCaseId: req.query.caseId || '',
            fullUrl: `${req.protocol}://${req.get('host')}/stories`
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.getStoriesFeed = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 3, 1), 5);
        let skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
        const caseId = (req.query.caseId || '').trim();

        const total = await Case.countDocuments(STORIES_FEED_FILTER);

        if (caseId && skip === 0) {
            const target = await Case.findOne({ ...STORIES_FEED_FILTER, _id: caseId })
                .select('createdAt')
                .lean();
            if (target) {
                skip = await Case.countDocuments({
                    ...STORIES_FEED_FILTER,
                    createdAt: { $gt: target.createdAt }
                });
            }
        }

        const stories = await Case.find(STORIES_FEED_FILTER)
            .select('title type description image storyVideo createdAt raisedAmount targetAmount monthlySponsorshipAmount')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const items = (await Promise.all(
            stories.map((story) => formatStoryForClient(story, { youtubeMuted: 0 }))
        )).filter(Boolean);

        res.set('Cache-Control', 'private, max-age=30');
        res.json({
            stories: items,
            skip,
            limit,
            total,
            hasMore: skip + stories.length < total
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ stories: [], hasMore: false, total: 0 });
    }
};

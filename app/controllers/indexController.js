const Case = require('../models/Case');
const Testimonial = require('../models/Testimonial');
const { getPlayableStoryVideoUrl, extractYouTubeId, buildYouTubeEmbedUrl } = require('../utils/storyVideo');

exports.getHomepage = async (req, res) => {
    try {
        // Fetch featured or recent cases that have a video story attached
        const cases = await Case.find({ 
            status: 'approved', 
            isHidden: { $ne: true },
            storyVideo: { $exists: true, $ne: '' } 
        }).limit(10).sort({ createdAt: -1 });
        
        // Mock data if DB is empty for initial run
        const demoCases = cases.length > 0 ? cases : [
            {
                _id: '1',
                title: 'كفالة أيتام عائلة الشهيد محمد',
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
        ];

        // Fetch approved testimonials
        const testimonials = await Testimonial.find({ status: 'approved' })
            .populate('user', 'name avatar')
            .sort({ createdAt: -1 });

        const preparedCases = demoCases.map((item) => {
            const plain = typeof item.toObject === 'function' ? item.toObject() : item;
            const storyVideoPlayable = getPlayableStoryVideoUrl(plain.storyVideo || '');
            const ytId = storyVideoPlayable ? extractYouTubeId(storyVideoPlayable) : null;
            return {
                ...plain,
                storyVideoPlayable,
                storyVideoIsYouTube: Boolean(ytId),
                storyYouTubeEmbedUrl: ytId ? buildYouTubeEmbedUrl(ytId, { muted: 1 }) : null
            };
        });

        res.render('pages/index', {
            title: res.__('home'),
            cases: preparedCases,
            testimonials: testimonials.length > 0 ? testimonials : [
                {
                    content: 'أجمل ما في سُبُل هو الشفافية المطلقة.. شعرت كأنني في غزة أضع الصدقة في يد المحتاج بنفسي.',
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
            ],
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

exports.getTransparency = (req, res) => {
    res.render('pages/transparency', { 
        title: res.__('navbar_transparency'),
        fullUrl: `${req.protocol}://${req.get('host')}/transparency`
    });
};

exports.getStoriesHub = async (req, res) => {
    try {
        // Fetch ALL approved cases with storyVideo sorted newest first
        const stories = await Case.find({
            status: 'approved', 
            isHidden: { $ne: true },
            isStoryHidden: { $ne: true },
            storyVideo: { $exists: true, $ne: '' } 
        }).sort({ createdAt: -1 });

        const preparedStories = stories
            .map((story) => {
                const plain = story.toObject();
                const storyVideoPlayable = getPlayableStoryVideoUrl(plain.storyVideo || '');
                const ytId = storyVideoPlayable ? extractYouTubeId(storyVideoPlayable) : null;
                return {
                    ...plain,
                    storyVideoPlayable,
                    storyVideoIsYouTube: Boolean(ytId),
                    storyYouTubeEmbedUrl: ytId ? buildYouTubeEmbedUrl(ytId, { muted: 0 }) : null
                };
            })
            .filter((story) => Boolean(story.storyVideoPlayable));

        res.render('pages/stories', {
            title: 'قصص سنابل - Stories',
            stories: preparedStories,
            fullUrl: `${req.protocol}://${req.get('host')}/stories`
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

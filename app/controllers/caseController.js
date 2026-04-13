const Case = require('../models/Case');
const Transaction = require('../models/Transaction');
const Team = require('../models/Team');
const ChatRequest = require('../models/ChatRequest');
const { cloudinary } = require('../utils/cloudinary');
const fs = require('fs');
const { logActivity } = require('../utils/logger');
const { getPlayableStoryVideoUrl, cloudinaryEnabled } = require('../utils/storyVideo');

exports.getRegisterCase = async (req, res) => {
    try {
        if (req.user.status === 'pending') {
            return res.render('pages/auth/pending-verification', { title: res.__('common_pending') });
        }

        // Feature: Restrict to 1 active case per beneficiary
        const activeCase = await Case.findOne({ 
            guardian: req.user._id, 
            status: { $in: ['pending', 'field_verification', 'approved'] },
            isSatisfied: { $ne: true }
        });

        if (activeCase) {
            req.flash('error', req.getLocale() === 'ar' ? 'نأسف، لديك طلب سابق لا يزال قيد المعالجة أو لم يحقق هدفه الكلي بعد. يرجى الانتظار حتى استكمال طلبك الحالي.' : 'Sorry, you have an existing case that is still processing or has not yet reached its target. Please wait until it is fully supported.');
            return res.redirect('/dashboard');
        }

        const Setting = require('../models/Setting');
        let caseNeedsConfig = await Setting.findOne({ key: 'case_needs' });
        const needsArray = caseNeedsConfig ? caseNeedsConfig.value.split(',').map(n => n.trim()).filter(n => n) : [
            res.__('needs_financial'),
            res.__('needs_housing'),
            res.__('needs_medical'),
            res.__('needs_sponsorship'),
            res.__('needs_other')
        ];

        res.render('pages/cases/register-case', { title: res.__('admin_nav_cases_manager'), caseNeeds: needsArray });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
};

exports.createCase = async (req, res) => {
    try {
        if (req.user.status === 'pending') {
            req.flash('error', res.__('flash_activate_first'));
            return res.redirect('/dashboard');
        }

        // Feature: Restrict to 1 active case per beneficiary
        const activeCase = await Case.findOne({ 
            guardian: req.user._id, 
            status: { $in: ['pending', 'field_verification', 'approved'] },
            isSatisfied: { $ne: true }
        });

        if (activeCase) {
            req.flash('error', req.getLocale() === 'ar' ? 'نأسف، لديك طلب سابق لا يزال قيد المعالجة أو لم يحقق هدفه الكلي بعد. يرجى الانتظار حتى استكمال طلبك الحالي.' : 'Sorry, you have an existing case that is still processing or has not yet reached its target. Please wait until it is fully supported.');
            return res.redirect('/dashboard');
        }

        const { title, type, description, location, storyAr, memberCount, orphanCount, familyCount, isFatherDeceased, father, mother, guardian, orphans, storyVideo } = req.body;
        const needs = req.body.needs || [];
        
        // Logical syncing for member counts
        const finalOrphanCount = type === 'orphan' ? (memberCount || orphanCount) : null;
        const finalFamilySize = type === 'family' ? (memberCount || familyCount) : null;

        // Strict Logic: Orphan cases require a deceased father
        if (type === 'orphan' && isFatherDeceased !== 'true') {
            req.flash('error', res.__('father_deceased_error'));
            return res.redirect('back');
        }

        const rawStoryVideo = storyVideo ? storyVideo.trim() : '';
        const normalizedStoryVideo = rawStoryVideo ? getPlayableStoryVideoUrl(rawStoryVideo) : undefined;
        if (storyVideo && !normalizedStoryVideo) {
            req.flash('error', 'رابط فيديو القصة غير مدعوم. استخدم رابط YouTube Shorts أو رابط Cloudinary.');
            return res.redirect('back');
        }
        // If Cloudinary isn't configured, direct-video links often fail on mobile due to codec/CORS/range issues.
        if (rawStoryVideo && normalizedStoryVideo === rawStoryVideo && !cloudinaryEnabled) {
            req.flash('error', 'تم تعطيل روابط الفيديو المباشرة مؤقتاً لأن Cloudinary غير مُعدّ على السيرفر، وهذا يسبب مشكلة (صوت بدون صورة) على الجوال. الرجاء استخدام YouTube Shorts أو إعداد Cloudinary.');
            return res.redirect('back');
        }

        const newCase = new Case({
            title,
            type,
            description,
            needs: Array.isArray(needs) ? needs : [needs],
            location,
            storyVideo: normalizedStoryVideo,
            guardian: req.user._id,
            details: {
                storyAr,
                familyCount: finalFamilySize,
                orphanCount: finalOrphanCount
            },
            familyStructure: {
                isFatherDeceased: isFatherDeceased === 'true',
                father: father && father.name ? father : undefined,
                mother: {
                    ...mother,
                    isDeceased: mother && mother.isDeceased === 'true'
                },
                guardian,
                orphans: Array.isArray(orphans) ? orphans : (orphans ? Object.values(orphans) : [])
            }
        });

        if (req.file) {
            try {
                // Upload to Cloudinary
                const result = await cloudinary.uploader.upload(req.file.path, {
                    folder: 'jussur-sanabel/cases'
                });
                newCase.image = result.secure_url;
                
                // Cleanup local file
                fs.unlinkSync(req.file.path);
            } catch (uploadErr) {
                console.error('Cloudinary Upload Error:', uploadErr);
                // Even if upload fails, try to cleanup
                if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
                throw uploadErr;
            }
        }

        await newCase.save();

        // Log the activity
        await logActivity(req.user._id, 'case_create', 'Case', newCase._id, 
            res.__('log_case_submitted', { title: newCase.title, type: newCase.type }));

        req.flash('success', res.__('flash_case_registered'));
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_case_register_error', { error: err.message }));
        res.redirect('/cases/register');
    }
};

exports.getAllCases = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 24, 1), 60);
        const skip = (page - 1) * limit;
        const filter = { status: 'approved', isHidden: { $ne: true } };

        const [cases, totalCases] = await Promise.all([
            Case.find(filter)
                .select('title type description image location raisedAmount targetAmount createdAt status')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Case.countDocuments(filter)
        ]);

        res.render('pages/cases/all-cases', {
            title: res.__('cases_list'),
            cases,
            pagination: {
                page,
                limit,
                total: totalCases,
                totalPages: Math.max(Math.ceil(totalCases / limit), 1)
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getCaseDetails = async (req, res) => {
    try {
        const foundCase = await Case.findById(req.params.id).populate('guardian').lean();
        if (!foundCase || foundCase.isHidden) {
            return res.status(404).render('errors/error', { title: '404', message: res.__('flash_case_not_found'), error: {} });
        }

        // Fetch recent transactions for this case (public ones)
        const recentDonors = await Transaction.find({ 
            case: req.params.id, 
            status: 'verified' 
        })
        .select('donor amount createdAt isAnonymous')
        .populate('donor', 'name avatar')
        .sort({ createdAt: -1 })
        .limit(10);

        // Fetch teams for this case (Phase 3)
        const teams = await Team.find({ case: req.params.id })
            .select('name description totalRaised members createdAt')
            .sort({ totalRaised: -1 })
            .lean();

        // Phase 13: Check if current donor has a pending or approved chat request for this FAMILY
        let chatRequest = null;
        if (req.user && req.user.role === 'donor') {
            chatRequest = await ChatRequest.findOne({
                donor: req.user._id,
                family: foundCase.guardian._id || foundCase.guardian
            });
        }

        // SEO and Social Sharing Data
        const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const metaDescription = foundCase.description ? 
            foundCase.description.substring(0, 160).replace(/\r?\n|\r/g, " ") : 
            foundCase.details.storyAr.substring(0, 160).replace(/\r?\n|\r/g, " ");

        res.render('pages/cases/case-details', { 
            title: foundCase.title, 
            foundCase, 
            recentDonors, 
            teams,
            chatRequest,
            metaDescription,
            ogImage: foundCase.image,
            fullUrl,
            csrfToken: req.csrfToken && req.csrfToken()
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};
exports.toggleFollowCase = async (req, res) => {
    try {
        const foundCase = await Case.findById(req.params.id);
        if (!foundCase) {
            return res.status(404).json({ success: false, message: res.__('flash_case_not_found') });
        }

        const isFollowing = foundCase.followers.includes(req.user._id);
        if (isFollowing) {
            foundCase.followers.pull(req.user._id);
        } else {
            foundCase.followers.push(req.user._id);
        }

        await foundCase.save();
        
        // Log the activity
        await logActivity(req.user._id, 'case_update', 'Case', req.params.id, 
            res.__('log_case_follow_toggle', { 
                action: isFollowing ? res.__('common_follow_stop') : res.__('common_follow_start'),
                title: foundCase.title 
            }));

        res.json({ 
            success: true, 
            message: isFollowing ? res.__('common_unfollow_success') : res.__('common_follow_success'),
            isFollowing: !isFollowing 
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('flash_error_update') });
    }
};
exports.createTeam = async (req, res) => {
    try {
        const { name, description } = req.body;
        const caseId = req.params.id;

        const existingTeam = await Team.findOne({ name, case: caseId });
        if (existingTeam) {
            return res.status(400).json({ success: false, message: res.__('flash_team_name_taken') });
        }

        const team = await Team.create({
            name,
            description,
            creator: req.user._id,
            case: caseId
        });

        // Log the activity
        await logActivity(req.user._id, 'case_update', 'Case', caseId, 
            res.__('log_case_team_created', { name, id: caseId.toString().slice(-6).toUpperCase() }));

        res.json({ success: true, message: res.__('flash_team_created'), team });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('flash_error_update') });
    }
};

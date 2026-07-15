const Case = require('../models/Case');
const Transaction = require('../models/Transaction');
const Team = require('../models/Team');
const ChatRequest = require('../models/ChatRequest');
const { cloudinary } = require('../utils/cloudinary');
const fs = require('fs');
const { logActivity } = require('../utils/logger');
const { resolveStoryVideoAsync, cloudinaryEnabled, prepareStoryVideoAsync } = require('../utils/storyVideo');
const { caseCardImageUrl } = require('../utils/imageUrl');
const { loadCaseRegistrationSettings, validateCaseContentForRequest } = require('../utils/caseRegistrationSettings');
const {
    PUBLIC_CASE_STATUSES,
    fundingPercent,
    fundingBarPercent,
    isDonationsClosed,
    showsCompletedBadge
} = require('../utils/caseSatisfaction');

const PLATFORM_ADMIN_ROLES = new Set(['admin', 'super_admin', 'regulator', 'media']);

const CASES_LIST_SELECT =
    'title type description image location area raisedAmount targetAmount createdAt status isFieldVerified isSatisfied storyVideo isStoryHidden';

function isMobileClient(req) {
    const ua = req.get('user-agent') || '';
    return /Mobile|Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

function parseCasesListQuery(req) {
    const selectedType = ['orphan', 'family'].includes(req.query.type) ? req.query.type : 'all';
    const defaultLimit = isMobileClient(req) ? 12 : 24;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || defaultLimit, 1), 48);
    const requestedPage = Math.max(parseInt(req.query.page, 10) || 1, 1);

    return { selectedType, limit, requestedPage, defaultLimit };
}

function buildCasesListFilter({ selectedType }) {
    const filter = { status: { $in: PUBLIC_CASE_STATUSES }, isHidden: { $ne: true } };

    if (selectedType !== 'all') {
        filter.type = selectedType;
    }

    return filter;
}

async function formatCaseForList(item) {
    const videoMeta = item.storyVideo && item.storyVideo.trim() && item.isStoryHidden !== true
        ? await prepareStoryVideoAsync(item.storyVideo)
        : { storyVideoPlayable: null };
    const hasStory = Boolean(videoMeta.storyVideoPlayable);

    return {
        _id: item._id,
        title: item.title,
        type: item.type,
        description: item.description,
        image: caseCardImageUrl(item.image),
        area: item.area || '',
        raisedAmount: item.raisedAmount || 0,
        targetAmount: item.targetAmount,
        isFieldVerified: Boolean(item.isFieldVerified),
        isSatisfied: showsCompletedBadge(item),
        hasStory,
        storyUrl: hasStory ? `/stories?caseId=${item._id}` : null,
        fundingPercent: fundingPercent(item),
        fundingBarPercent: fundingBarPercent(item)
    };
}

async function fetchCasesList({ filter, skip, limit }) {
    return Case.find(filter)
        .select(CASES_LIST_SELECT)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
}

function buildCasesListUrl(state, overrides = {}) {
    const merged = {
        type: state.selectedType,
        limit: state.limit,
        page: '',
        ...overrides
    };

    const params = new URLSearchParams();
    if (merged.type && merged.type !== 'all') params.set('type', merged.type);
    if (merged.limit) params.set('limit', String(merged.limit));
    if (merged.page && Number(merged.page) > 1) params.set('page', String(merged.page));

    const qs = params.toString();
    return '/cases' + (qs ? `?${qs}` : '');
}

function hasOwnBankAccount(user) {
    const iban = (user?.paymentDetails?.iban || '').replace(/\s+/g, '').toUpperCase();
    const accountHolder = (user?.paymentDetails?.accountHolder || '').trim();
    const userName = (user?.name || '').trim();
    if (!iban || !accountHolder || !userName) return false;
    return accountHolder.replace(/\s+/g, ' ').toLowerCase() === userName.replace(/\s+/g, ' ').toLowerCase();
}

function canViewFamilyStructure(user, caseDoc) {
    if (!user) return false;
    if (PLATFORM_ADMIN_ROLES.has(user.role)) return true;
    const guardianId = (caseDoc.guardian?._id || caseDoc.guardian)?.toString();
    return Boolean(guardianId && user._id.toString() === guardianId);
}

exports.getRegisterCase = async (req, res) => {
    try {
        if (req.user.status === 'pending') {
            return res.redirect('/auth/pending');
        }

        if (!hasOwnBankAccount(req.user)) {
            req.flash('error', res.__('flash_bank_account_required_for_case'));
            return res.redirect('/dashboard');
        }

        // Feature: Restrict to 1 active case per beneficiary
        const activeCase = await Case.findOne({ 
            guardian: req.user._id, 
            status: { $in: ['pending', 'field_verification', 'media_review', 'approved'] },
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

        const registrationSettings = await loadCaseRegistrationSettings();
        const registrationGuide = req.getLocale() === 'en'
            ? registrationSettings.registrationGuideEn
            : registrationSettings.registrationGuideAr;

        res.render('pages/cases/register-case', {
            title: res.__('admin_nav_cases_manager'),
            caseNeeds: needsArray,
            registrationGuide,
            caseTemplateOrphanAr: registrationSettings.caseTemplateOrphanAr,
            caseTemplateFamilyAr: registrationSettings.caseTemplateFamilyAr,
            caseTemplateDescAr: registrationSettings.caseTemplateDescAr,
            forbiddenWords: registrationSettings.forbiddenWords
        });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
};

exports.createCase = async (req, res) => {
    try {
        if (req.user.status === 'pending') {
            req.flash('error', res.__('flash_activate_first'));
            return res.redirect('/auth/pending');
        }

        if (!hasOwnBankAccount(req.user)) {
            req.flash('error', res.__('flash_bank_account_required_for_case'));
            return res.redirect('/dashboard');
        }

        // Feature: Restrict to 1 active case per beneficiary
        const activeCase = await Case.findOne({ 
            guardian: req.user._id, 
            status: { $in: ['pending', 'field_verification', 'media_review', 'approved'] },
            isSatisfied: { $ne: true }
        });

        if (activeCase) {
            req.flash('error', req.getLocale() === 'ar' ? 'نأسف، لديك طلب سابق لا يزال قيد المعالجة أو لم يحقق هدفه الكلي بعد. يرجى الانتظار حتى استكمال طلبك الحالي.' : 'Sorry, you have an existing case that is still processing or has not yet reached its target. Please wait until it is fully supported.');
            return res.redirect('/dashboard');
        }

        const { title, type, description, location, storyAr, memberCount, orphanCount, familyCount, isFatherDeceased, father, mother, guardian, orphans, storyVideo } = req.body;
        const needs = req.body.needs || [];

        const contentOk = await validateCaseContentForRequest(req, res, {
            title,
            description,
            storyAr
        }, 'back');
        if (!contentOk) return;
        
        // Logical syncing for member counts
        const finalOrphanCount = type === 'orphan' ? (memberCount || orphanCount) : null;
        const finalFamilySize = type === 'family' ? (memberCount || familyCount) : null;

        // Strict Logic: Orphan cases require a deceased father
        if (type === 'orphan' && isFatherDeceased !== 'true') {
            req.flash('error', res.__('father_deceased_error'));
            return res.redirect('back');
        }

        const rawStoryVideo = storyVideo ? storyVideo.trim() : '';
        const storyResolved = rawStoryVideo ? await resolveStoryVideoAsync(rawStoryVideo) : null;
        const normalizedStoryVideo = storyResolved && storyResolved.valid ? storyResolved.storedUrl : undefined;
        if (storyVideo && !normalizedStoryVideo) {
            req.flash('error', res.__('story_video_invalid_link'));
            return res.redirect('back');
        }
        if (rawStoryVideo && storyResolved && storyResolved.provider === 'html5' && !cloudinaryEnabled) {
            req.flash('error', res.__('story_video_cloudinary_required'));
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

        const uploadedFiles = Array.isArray(req.files) ? req.files : [];
        if (uploadedFiles.length > 3) {
            req.flash('error', 'يمكنك رفع 3 صور كحد أقصى لكل حالة.');
            return res.redirect('back');
        }

        if (uploadedFiles.length > 0) {
            const uploadedUrls = [];

            try {
                for (const file of uploadedFiles) {
                    const result = await cloudinary.uploader.upload(file.path, {
                        folder: 'jussur-sanabel/cases'
                    });
                    uploadedUrls.push(result.secure_url);
                }

                // Keep current UX: first image as main cover, rest as gallery.
                newCase.image = uploadedUrls[0];
                newCase.gallery = uploadedUrls.slice(1);
            } catch (uploadErr) {
                console.error('Cloudinary Upload Error:', uploadErr);
                throw uploadErr;
            } finally {
                for (const file of uploadedFiles) {
                    if (file && file.path && fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                }
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
        const listQuery = parseCasesListQuery(req);
        const { selectedType, limit, requestedPage } = listQuery;
        const filter = buildCasesListFilter({ selectedType });

        const totalCases = await Case.countDocuments(filter);
        const totalPages = Math.max(Math.ceil(totalCases / limit), 1);
        const page = Math.min(requestedPage, totalPages);
        const skip = (page - 1) * limit;

        const rawCases = await fetchCasesList({ filter, skip, limit });
        const cases = await Promise.all(rawCases.map(formatCaseForList));

        res.render('pages/cases/all-cases', {
            title: res.__('cases_list'),
            cases,
            selectedType,
            defaultLimit: listQuery.defaultLimit,
            buildCasesUrl: (overrides) => buildCasesListUrl(listQuery, overrides),
            pagination: {
                page,
                limit,
                total: totalCases,
                totalPages
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getCasesFeed = async (req, res) => {
    try {
        const listQuery = parseCasesListQuery(req);
        const { selectedType, limit, requestedPage } = listQuery;
        const filter = buildCasesListFilter({ selectedType });

        const totalCases = await Case.countDocuments(filter);
        const totalPages = Math.max(Math.ceil(totalCases / limit), 1);
        const page = Math.min(requestedPage, totalPages);
        const skip = (page - 1) * limit;

        const rawCases = await fetchCasesList({ filter, skip, limit });
        const cases = await Promise.all(rawCases.map(formatCaseForList));

        res.json({
            cases,
            pagination: {
                page,
                limit,
                total: totalCases,
                totalPages,
                hasMore: page < totalPages
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: res.__('error_server') });
    }
};

exports.getCaseDetails = async (req, res) => {
    try {
        const foundCase = await Case.findById(req.params.id).populate('guardian').lean();
        if (!foundCase || foundCase.isHidden) {
            return res.status(404).render('errors/error', { title: '404', message: res.__('flash_case_not_found'), error: {} });
        }

        if (foundCase.status === 'fully_sponsored') {
            foundCase.status = 'completed';
            Case.findByIdAndUpdate(req.params.id, { status: 'completed' }).catch(() => {});
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

        const showFamilyStructure = canViewFamilyStructure(req.user, foundCase);
        if (!showFamilyStructure) {
            delete foundCase.familyStructure;
        }

        res.render('pages/cases/case-details', { 
            title: foundCase.title, 
            foundCase, 
            recentDonors, 
            teams,
            chatRequest,
            canViewFamilyStructure: showFamilyStructure,
            donationsClosed: isDonationsClosed(foundCase),
            showCompletedBadge: showsCompletedBadge(foundCase),
            fundingPercent: fundingPercent(foundCase),
            fundingBarPercent: fundingBarPercent(foundCase),
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

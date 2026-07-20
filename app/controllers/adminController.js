const mongoose = require('mongoose');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');
const Case = require('../models/Case');
const User = require('../models/User');
const ChatRequest = require('../models/ChatRequest');
const Message = require('../models/Message');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const CaseUpdate = require('../models/CaseUpdate');
const SupportTicket = require('../models/SupportTicket');
const Team = require('../models/Team');
const Testimonial = require('../models/Testimonial');
const AdminRequest = require('../models/AdminRequest');
const { cloudinary } = require('../utils/cloudinary');
const { buildExcel } = require('../utils/excelXml');
const fs = require('fs');
const path = require('path');
const { logActivity } = require('../utils/logger');
const { getPlayableStoryVideoUrlAsync } = require('../utils/storyVideo');
const { normalizePalestinianId } = require('../utils/palestinianIdValidator');
const { applyGoalReachedState, hasReachedFundingGoal, normalizeLegacyCompletedStatus } = require('../utils/caseSatisfaction');
const { validateCaseContentForRequest, loadCaseRegistrationSettings } = require('../utils/caseRegistrationSettings');
const { validateCaseTextFields, isLikelyCopiedFromExamples } = require('../utils/contentFilter');
const { invalidatePublicCaseCaches } = require('../middlewares/cache');
const { isCustomAvatarUrl } = require('../utils/userAvatar');

const PASSWORD_RECOVERY_ROLES = ['donor', 'beneficiary', 'family', 'guardian'];

function sanitizeAdminReturnPath(value, fallback = '/admin/dashboard') {
    const path = String(value || '').trim();
    if (path.startsWith('/admin/') && !path.includes('//')) return path;
    return fallback;
}

function caseDetailsSnapshot(caseDoc) {
    const details = caseDoc.details && typeof caseDoc.details.toObject === 'function'
        ? caseDoc.details.toObject()
        : { ...(caseDoc.details || {}) };
    return details;
}

function normalizeMultilineText(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function readMediaTextFields(req) {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const missing = [];
    if (body.title == null) missing.push('title');
    if (body.description == null) missing.push('description');
    if (body.storyAr == null) missing.push('storyAr');

    if (missing.length) {
        return { ok: false, missing };
    }

    const title = String(body.title).trim();
    const description = String(body.description).trim();
    const storyAr = String(body.storyAr).trim();
    const storyVideo = body.storyVideo != null ? String(body.storyVideo).trim() : '';

    if (!title || !description || !storyAr) {
        return { ok: false, missing: ['empty_fields'] };
    }

    return { ok: true, title, description, storyAr, storyVideo };
}

function mergeOptionalCaseTextFields(updateData, { title, description, storyAr }, priorDetails) {
    if (title != null && String(title).trim()) {
        updateData.title = String(title).trim();
    }
    if (description != null && String(description).trim()) {
        updateData.description = String(description).trim();
    }
    if (storyAr !== undefined && String(storyAr).trim()) {
        updateData.details = {
            familyCount: priorDetails.familyCount,
            orphanCount: priorDetails.orphanCount,
            storyAr: String(storyAr).trim()
        };
    }
}

async function persistCaseDocumentUpdate(caseDoc, updateData) {
    const $set = {};
    for (const [key, value] of Object.entries(updateData)) {
        if (value === undefined) continue;
        if (key === 'details' && value && typeof value === 'object') {
            for (const [detailKey, detailValue] of Object.entries(value)) {
                if (detailValue === undefined) continue;
                $set[`details.${detailKey}`] = detailValue;
            }
        } else {
            $set[key] = value;
        }
    }

    if (!Object.keys($set).length) return caseDoc;

    const result = await Case.collection.updateOne({ _id: caseDoc._id }, { $set });
    if (result.matchedCount !== 1) {
        throw new Error('case_update_not_matched');
    }

    return Case.findById(caseDoc._id);
}

async function verifyPersistedCaseContent(caseId, expected = {}) {
    const saved = await Case.findById(caseId).lean();
    if (!saved) return { ok: false, reason: 'not_found' };

    if (expected.title !== undefined && saved.title !== expected.title) {
        return { ok: false, reason: 'title' };
    }
    if (expected.description !== undefined) {
        const savedDescription = normalizeMultilineText(saved.description);
        const expectedDescription = normalizeMultilineText(expected.description);
        if (savedDescription !== expectedDescription) {
            return { ok: false, reason: 'description' };
        }
    }
    if (expected.storyAr !== undefined) {
        const savedStory = normalizeMultilineText(saved.details?.storyAr);
        const expectedStory = normalizeMultilineText(expected.storyAr);
        if (savedStory !== expectedStory) {
            return { ok: false, reason: 'storyAr' };
        }
    }

    return { ok: true, saved };
}

async function evaluateCaseContentFields({ title, description, storyAr }) {
    const settings = await loadCaseRegistrationSettings({ ensureDefaults: false });
    const validation = validateCaseTextFields({
        title,
        description,
        storyAr,
        forbiddenWords: settings.forbiddenWords
    });

    if (!validation.ok) {
        const { field, word } = validation.matches[0];
        return { ok: false, code: 'forbidden_word', field, word };
    }

    const examples = settings.storyExamples || [];
    if (isLikelyCopiedFromExamples(storyAr, examples)) {
        return { ok: false, code: 'copied_story' };
    }
    if (isLikelyCopiedFromExamples(description, examples)) {
        return { ok: false, code: 'copied_description' };
    }

    return { ok: true };
}

async function assertMediaContentAccess(req, res, existingCase) {
    const role = req.user.role;
    const allowed =
        (role === 'media' && existingCase.status === 'media_review') ||
        (role === 'super_admin' && ['media_review', 'approved'].includes(existingCase.status));

    if (!allowed) {
        req.flash('error', res.__('admin_case_error_media_content_forbidden'));
        res.redirect('/admin/cases-manager');
        return false;
    }
    return true;
}

function generateTempPassword() {
    return crypto.randomBytes(6).toString('base64url').slice(0, 10);
}

function buildPasswordRecoverySearchQuery(searchTerm) {
    const q = (searchTerm || '').trim();
    if (!q) return null;

    const orConditions = [
        { name: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
    ];

    const normalizedId = normalizePalestinianId(q);
    if (normalizedId) {
        orConditions.push({ idNumber: normalizedId });
    }

    return {
        role: { $in: PASSWORD_RECOVERY_ROLES },
        $or: orConditions
    };
}

function dateRange(from, to) {
    const q = {};
    if (from || to) {
        q.createdAt = {};
        if (from) q.createdAt.$gte = new Date(from + 'T00:00:00');
        if (to) q.createdAt.$lte = new Date(to + 'T23:59:59');
    }
    return q;
}

function safeRegex(input = '') {
    const s = String(input || '').trim();
    if (!s) return null;
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(escaped, 'i');
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('ar-EG');
}

function buildDonationsLedgerPipeline({ filters = {}, search = null, includeTotalsFacet = false, skip = 0, limit = 50 }) {
    const match = {};

    if (filters.status && filters.status !== 'all') match.status = filters.status;
    if (filters.type && filters.type !== 'all') match.type = filters.type;
    if (filters.paymentMethod && filters.paymentMethod !== 'all') match.paymentMethod = filters.paymentMethod;
    if (filters.disbursementStatus && filters.disbursementStatus !== 'all') match.disbursementStatus = filters.disbursementStatus;
    if (filters.isBankConfirmed && filters.isBankConfirmed !== 'all') match.isBankConfirmed = filters.isBankConfirmed === 'true';

    Object.assign(match, dateRange(filters.from, filters.to));

    const pipeline = [
        { $match: match },
        { $sort: { createdAt: -1 } },
        {
            $lookup: {
                from: 'users',
                localField: 'donor',
                foreignField: '_id',
                as: 'donorDoc'
            }
        },
        { $unwind: { path: '$donorDoc', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'cases',
                localField: 'case',
                foreignField: '_id',
                as: 'caseDoc'
            }
        },
        { $unwind: { path: '$caseDoc', preserveNullAndEmptyArrays: true } },
        {
            $lookup: {
                from: 'teams',
                localField: 'team',
                foreignField: '_id',
                as: 'teamDoc'
            }
        },
        { $unwind: { path: '$teamDoc', preserveNullAndEmptyArrays: true } },
        {
            $addFields: {
                _idStr: { $toString: '$_id' },
                _idShort: { $toUpper: { $substrCP: [{ $toString: '$_id' }, 16, 8] } },
                donorName: '$donorDoc.name',
                donorEmail: '$donorDoc.email',
                caseTitle: '$caseDoc.title',
                teamName: '$teamDoc.name'
            }
        }
    ];

    if (search) {
        pipeline.push({
            $match: {
                $or: [
                    { _idStr: { $regex: search } },
                    { _idShort: { $regex: search } },
                    { stripeSessionId: { $regex: search } },
                    { stripePaymentIntentId: { $regex: search } },
                    { donorName: { $regex: search } },
                    { donorEmail: { $regex: search } },
                    { caseTitle: { $regex: search } },
                    { teamName: { $regex: search } }
                ]
            }
        });
    }

    const dataPipeline = [
        { $skip: Math.max(0, Number(skip || 0)) },
        { $limit: Math.max(1, Math.min(Number(limit || 50), 200)) }
    ];

    const totalsFacet = includeTotalsFacet
        ? [{
            $group: {
                _id: null,
                count: { $sum: 1 },
                sumAmount: { $sum: { $ifNull: ['$amount', 0] } },
                sumInstitutionFee: { $sum: { $ifNull: ['$institutionFee', 0] } },
                sumGatewayFee: { $sum: { $ifNull: ['$gatewayFee', 0] } },
                sumOperationFee: { $sum: { $ifNull: ['$operationFee', 0] } },
                sumTotalAmount: { $sum: { $ifNull: ['$totalAmount', 0] } }
            }
        }]
        : [{ $count: 'count' }];

    pipeline.push({
        $facet: {
            meta: totalsFacet,
            data: dataPipeline
        }
    });

    pipeline.push({
        $addFields: {
            meta: { $ifNull: [{ $arrayElemAt: ['$meta', 0] }, { count: 0 }] }
        }
    });

    return pipeline;
}

function extractCloudinaryPublicId(assetUrl = '') {
    try {
        const parsed = new URL(assetUrl);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const uploadIndex = parts.indexOf('upload');
        if (uploadIndex === -1) return null;

        let publicIdParts = parts.slice(uploadIndex + 1);
        const versionIndex = publicIdParts.findIndex((p) => /^v\d+$/.test(p));
        if (versionIndex !== -1) {
            publicIdParts = publicIdParts.slice(versionIndex + 1);
        }

        if (!publicIdParts.length) return null;
        const last = publicIdParts[publicIdParts.length - 1];
        publicIdParts[publicIdParts.length - 1] = last.replace(/\.[a-z0-9]+$/i, '');
        return publicIdParts.join('/');
    } catch (_err) {
        return null;
    }
}

function resolveLocalUploadPath(assetUrl = '') {
    if (!assetUrl || typeof assetUrl !== 'string') return null;
    if (/^https?:\/\//i.test(assetUrl)) return null;

    let normalized = assetUrl.replace(/\\/g, '/');
    if (normalized.startsWith('/public/')) {
        normalized = normalized.replace(/^\/public/, '');
    }

    if (!normalized.startsWith('/uploads/')) return null;
    return path.join(process.cwd(), 'public', normalized.replace(/^\//, ''));
}

async function deleteAssetUrl(assetUrl = '') {
    if (!assetUrl || typeof assetUrl !== 'string') return;

    const localPath = resolveLocalUploadPath(assetUrl);
    if (localPath) {
        try {
            await fs.promises.unlink(localPath);
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.error('Asset local delete failed:', localPath, err.message);
            }
        }
    }

    if (/res\.cloudinary\.com/i.test(assetUrl)) {
        const publicId = extractCloudinaryPublicId(assetUrl);
        if (!publicId) return;
        const resourceType = /\/video\//i.test(assetUrl) ? 'video' : 'image';
        try {
            await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
        } catch (err) {
            console.error('Asset cloudinary delete failed:', publicId, err.message);
        }
    }
}

async function purgeMediaAssets(assetUrls = []) {
    const uniqueUrls = [...new Set((assetUrls || []).filter(Boolean))];
    await Promise.all(uniqueUrls.map((url) => deleteAssetUrl(url)));
}

async function hardDeleteUserCompletely(userId, session = null) {
    const options = session ? { session } : {};
    const id = new mongoose.Types.ObjectId(userId);

    const userDoc = await User.findById(id).select('avatar').session(session).lean();
    const ownedCases = await Case.find({ guardian: id })
        .select('image gallery storyVideo updates')
        .session(session)
        .lean();

    const caseIds = ownedCases.map((c) => c._id);

    const caseUpdateFilter = caseIds.length
        ? { $or: [{ guardian: id }, { case: { $in: caseIds } }] }
        : { guardian: id };

    const caseUpdates = await CaseUpdate.find(caseUpdateFilter).select('images').session(session).lean();
    const messagesWithImages = await Message.find({
        $or: [{ sender: id }, { receiver: id }],
        imageUrl: { $exists: true, $ne: '' }
    })
        .select('imageUrl')
        .session(session)
        .lean();

    const mediaAssets = [];
    if (userDoc && isCustomAvatarUrl(userDoc.avatar)) mediaAssets.push(userDoc.avatar);

    for (const c of ownedCases) {
        if (c.image) mediaAssets.push(c.image);
        if (Array.isArray(c.gallery)) mediaAssets.push(...c.gallery);
        if (c.storyVideo) mediaAssets.push(c.storyVideo);

        if (Array.isArray(c.updates)) {
            for (const update of c.updates) {
                if (Array.isArray(update.images)) {
                    mediaAssets.push(...update.images);
                }
            }
        }
    }

    for (const update of caseUpdates) {
        if (Array.isArray(update.images)) {
            mediaAssets.push(...update.images);
        }
    }

    for (const msg of messagesWithImages) {
        if (msg.imageUrl) mediaAssets.push(msg.imageUrl);
    }

    await CaseUpdate.deleteMany(caseUpdateFilter, options);
    await Case.deleteMany({ guardian: id }, options);
    await ChatRequest.deleteMany({ $or: [{ donor: id }, { family: id }] }, options);
    await Message.deleteMany({ $or: [{ sender: id }, { receiver: id }] }, options);
    await SupportTicket.deleteMany({ user: id }, options);
    await Notification.deleteMany({
        $or: [{ sender: id }, { recipient: id }, { readBy: id }]
    }, options);
    await Team.deleteMany({ creator: id }, options);
    await Testimonial.deleteMany({ user: id }, options);
    await AdminRequest.deleteMany({
        $or: [{ requester: id }, { targetUser: id }, { resolvedBy: id }]
    }, options);
    await ActivityLog.deleteMany({
        $or: [{ user: id }, { targetType: 'User', targetId: id }]
    }, options);

    await User.updateMany(
        { 'blockedUsers.user': id },
        { $pull: { blockedUsers: { user: id } } },
        options
    );

    await User.updateMany(
        { 'moderationNotes.admin': id },
        { $pull: { moderationNotes: { admin: id } } },
        options
    );

    await Case.updateMany(
        { $or: [{ currentSponsor: id }, { followers: id }] },
        { $unset: { currentSponsor: '' }, $pull: { followers: id } },
        options
    );

    await User.findByIdAndDelete(id, options);
    return mediaAssets;
}

exports.getAdminDashboard = async (req, res) => {
    try {
        if (req.user.role === 'media') {
            return res.redirect('/admin/cases-manager');
        }

        const pendingCases = await Case.find({ status: 'pending' }).sort({ createdAt: -1 });
        const pendingTransactions = await Transaction.find({
            status: 'pending',
            paymentMethod: { $ne: 'stripe_checkout' }
        }).populate('donor case').sort({ createdAt: -1 });
        const allTransactions = await Transaction.find({ status: 'verified' });
        
        const totalPlatformDonations = allTransactions.reduce((acc, curr) => acc + curr.amount, 0);
        const totalOperationFees = allTransactions.reduce((acc, curr) => acc + (curr.institutionFee || 0), 0);
        const activeMonthlySponsorships = allTransactions.filter(t => t.type === 'monthly').length;
        
        const recentCases = await Case.find().limit(10).sort({ createdAt: -1 });
        
        // Phase 11: Impact Proofs
        const CaseUpdate = require('../models/CaseUpdate');
        const pendingImpactProofs = await CaseUpdate.find({ status: 'pending' }).populate('case guardian').limit(5).sort({ createdAt: -1 });
        const pendingImpactProofsCount = await CaseUpdate.countDocuments({ status: 'pending' });

        let extraStats = {};
        if (req.user.role === 'super_admin') {
            extraStats = {
                adminsCount: await User.countDocuments({ role: 'admin' }),
                beneficiaryCount: await User.countDocuments({ role: { $in: ['beneficiary', 'family', 'guardian'] } }),
                donorCount: await User.countDocuments({ role: 'donor' }),
                operationFees: totalOperationFees
            };
        }

        res.render('pages/admin/dashboard', { 
            title: res.__('admin_sidebar_dashboard'),
            pendingCases,
            pendingTransactions,
            recentCases,
            stats: {
                totalDonations: totalPlatformDonations,
                activeSponsorships: activeMonthlySponsorships,
                totalUsers: await User.countDocuments(),
                pendingImpactCount: pendingImpactProofsCount,
                ...extraStats
            },
            pendingImpactProofs
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getUsersManager = async (req, res) => {
    try {
        const admins = await User.find({ role: { $in: ['admin', 'super_admin', 'regulator', 'support', 'media'] } }).sort({ createdAt: -1 });
        res.render('pages/admin/users-manager', {
            title: res.__('admin_sidebar_team_management'),
            admins
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.createCase = async (req, res) => {
    try {
        const { 
            title, type, description, targetAmount, monthlySponsorshipAmount, 
            location, area, housingStatus, isFieldVerified, familyCount, orphanCount, storyAr 
        } = req.body;
        
        const mainImage = req.files['image'] ? `/uploads/cases/${req.files['image'][0].filename}` : null;
        const gallery = req.files['gallery'] ? req.files['gallery'].map(file => `/uploads/cases/${file.filename}`) : [];

        await Case.create({
            title,
            type,
            description,
            image: mainImage,
            gallery,
            targetAmount,
            monthlySponsorshipAmount,
            location,
            area,
            housingStatus,
            isFieldVerified: isFieldVerified === 'on' || isFieldVerified === true,
            details: {
                familyCount,
                orphanCount,
                storyAr
            }
        });

        req.flash('success', res.__('flash_case_created'));
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.updateCase = async (req, res) => {
    try {
        const existingCase = await Case.findById(req.params.id);
        if (!existingCase) {
            req.flash('error', res.__('flash_case_not_found'));
            return res.redirect('/admin/cases-manager');
        }

        const actorRole = req.user.role;
        const fromStatus = existingCase.status;
        const {
            title, type, description, targetAmount, monthlySponsorshipAmount, status,
            location, area, housingStatus, isFieldVerified, familyCount, orphanCount,
            storyAr, verificationNotes, rejectionReason, impactMetrics
        } = req.body;
        const toStatus = status;

        if (actorRole === 'media') {
            if (fromStatus !== 'media_review') {
                req.flash('error', res.__('admin_case_error_media_only_media_review'));
                return res.redirect('/admin/cases-manager');
            }
            if (!['approved', 'rejected'].includes(toStatus)) {
                req.flash('error', res.__('admin_case_error_media_final_only'));
                return res.redirect('/admin/cases-manager');
            }
        } else if (actorRole === 'admin') {
            if (fromStatus === 'field_verification' && toStatus === 'approved') {
                req.flash('error', res.__('admin_case_error_approve_needs_media_stage'));
                return res.redirect('/admin/cases-manager');
            }
            if (fromStatus === 'media_review' && toStatus !== 'rejected') {
                req.flash('error', res.__('admin_case_error_media_stage_super_or_media'));
                return res.redirect('/admin/cases-manager');
            }
        }

        const priorDetails = caseDetailsSnapshot(existingCase);

        const uploadRel = (file) => `/uploads/${file.filename}`;

        let updateData;

        if (actorRole === 'media') {
            updateData = {
                status: toStatus,
                verificationNotes
            };
            if (toStatus === 'approved') {
                updateData.rejectionReason = null;
            } else {
                updateData.rejectionReason = rejectionReason;
            }
            if (title != null && String(title).trim()) updateData.title = String(title).trim();
            if (description != null && String(description).trim()) updateData.description = String(description).trim();
            if (familyCount || orphanCount || (storyAr !== undefined && String(storyAr).trim())) {
                updateData.details = {
                    familyCount: familyCount !== undefined && familyCount !== '' ? familyCount : priorDetails.familyCount,
                    orphanCount: orphanCount !== undefined && orphanCount !== '' ? orphanCount : priorDetails.orphanCount,
                    storyAr: storyAr !== undefined && String(storyAr).trim()
                        ? String(storyAr).trim()
                        : priorDetails.storyAr
                };
            }
            const rawVideo = req.body.storyVideo != null ? String(req.body.storyVideo).trim() : '';
            if (rawVideo) {
                const normalized = await getPlayableStoryVideoUrlAsync(rawVideo);
                if (!normalized) {
                    req.flash('error', res.__('admin_media_story_video_invalid'));
                    return res.redirect(`/admin/cases/${req.params.id}/media-review`);
                }
                updateData.storyVideo = normalized;
            }
            if (targetAmount !== undefined && targetAmount !== '') updateData.targetAmount = targetAmount;
            if (monthlySponsorshipAmount !== undefined && monthlySponsorshipAmount !== '') {
                updateData.monthlySponsorshipAmount = monthlySponsorshipAmount;
            }
            if (impactMetrics) {
                try {
                    const parsed = JSON.parse(impactMetrics);
                    if (Array.isArray(parsed)) updateData.impactMetrics = parsed;
                } catch (_) { /* keep existing */ }
            }
            const imgFile = req.files && req.files.image && req.files.image[0];
            if (imgFile) updateData.image = uploadRel(imgFile);
            const galFiles = req.files && req.files.gallery;
            if (galFiles && galFiles.length) {
                const newGallery = galFiles.map((file) => uploadRel(file));
                updateData.gallery = [...(existingCase.gallery || []), ...newGallery];
            }
        } else {
            updateData = {
                status: toStatus,
                location,
                area,
                housingStatus,
                isFieldVerified: isFieldVerified === 'on' || isFieldVerified === true,
                verificationNotes,
                rejectionReason: toStatus === 'rejected' ? rejectionReason : null
            };
            if (impactMetrics) {
                try {
                    const parsed = JSON.parse(impactMetrics);
                    if (Array.isArray(parsed)) updateData.impactMetrics = parsed;
                } catch (_) { /* ignore invalid */ }
            }

            if (title != null && String(title).trim()) updateData.title = String(title).trim();
            if (type) updateData.type = type;
            if (description != null && String(description).trim()) updateData.description = String(description).trim();

            if (targetAmount !== undefined && targetAmount !== '') updateData.targetAmount = targetAmount;
            if (monthlySponsorshipAmount !== undefined && monthlySponsorshipAmount !== '') {
                updateData.monthlySponsorshipAmount = monthlySponsorshipAmount;
            }

            if (familyCount || orphanCount || (storyAr !== undefined && String(storyAr).trim())) {
                updateData.details = {
                    familyCount: familyCount !== undefined && familyCount !== '' ? familyCount : priorDetails.familyCount,
                    orphanCount: orphanCount !== undefined && orphanCount !== '' ? orphanCount : priorDetails.orphanCount,
                    storyAr: storyAr !== undefined && String(storyAr).trim()
                        ? String(storyAr).trim()
                        : priorDetails.storyAr
                };
            }

            const imgFile = req.files && req.files.image && req.files.image[0];
            if (imgFile) updateData.image = uploadRel(imgFile);
            const galFiles = req.files && req.files.gallery;
            if (galFiles && galFiles.length) {
                const newGallery = galFiles.map((file) => uploadRel(file));
                updateData.gallery = [...(existingCase.gallery || []), ...newGallery];
            }
        }

        const finalTitle = updateData.title !== undefined ? updateData.title : existingCase.title;
        const finalDescription = updateData.description !== undefined ? updateData.description : existingCase.description;
        const finalStoryAr = updateData.details?.storyAr !== undefined
            ? updateData.details.storyAr
            : priorDetails.storyAr;

        if (
            updateData.title !== undefined
            || updateData.description !== undefined
            || updateData.details?.storyAr !== undefined
        ) {
            const redirectTo = actorRole === 'media'
                ? `/admin/cases/${req.params.id}/media-review`
                : '/admin/cases-manager';
            const contentOk = await validateCaseContentForRequest(req, res, {
                title: finalTitle,
                description: finalDescription,
                storyAr: finalStoryAr
            }, redirectTo);
            if (!contentOk) return;
        }

        const updatedCase = await persistCaseDocumentUpdate(existingCase, updateData);
        await invalidatePublicCaseCaches(updatedCase._id);

        // ─── Enforce single-active-case rule ────────────────────────────────────
        if (toStatus === 'approved') {
            const newlyApprovedCase = updatedCase;
            if (newlyApprovedCase && newlyApprovedCase.guardian) {
                await Case.updateMany(
                    {
                        guardian: newlyApprovedCase.guardian,
                        _id: { $ne: newlyApprovedCase._id },
                        isSatisfied: true,
                        satisfiedBy: 'guardian'
                    },
                    { $set: { satisfiedBy: 'admin' } }
                );
            }
        }
        // ────────────────────────────────────────────────────────────────────────

        let logMessage = res.__('log_case_status_update', { status: res.__('status_' + toStatus) });
        if (toStatus === 'approved') {
            logMessage = res.__('log_case_approved_vouch', { area, housingStatus });
        } else if (toStatus === 'rejected') {
            logMessage = res.__('log_case_rejected_reason', { reason: rejectionReason });
        } else if (toStatus === 'media_review') {
            logMessage = res.__('log_case_media_review');
        }
        await logActivity(req.user._id, 'case_update', 'Case', req.params.id, logMessage);

        if (updatedCase && updatedCase.guardian) {
            let notifMessage = '';
            let notifType = 'info';

            if (toStatus === 'approved') {
                notifMessage = res.__('notif_case_approved_msg');
                notifType = 'success';
            } else if (toStatus === 'rejected') {
                notifMessage = res.__('notif_case_rejected_msg', { reason: rejectionReason || '—' });
                notifType = 'danger';
            } else if (toStatus === 'completed' || toStatus === 'fully_sponsored') {
                notifMessage = res.__('notif_case_completed_msg') || res.__('notif_case_satisfied_msg');
                notifType = 'success';
            } else if (toStatus === 'media_review') {
                notifMessage = res.__('notif_case_media_review_msg');
                notifType = 'info';
            }

            if (notifMessage) {
                const notification = await Notification.create({
                    recipient: updatedCase.guardian,
                    sender: req.user._id,
                    title: res.__('notif_case_status_title'),
                    message: notifMessage,
                    type: notifType,
                    targetType: 'specific',
                    link: `/cases/${updatedCase._id}`
                });

                const io = req.app.get('io');
                if (io) {
                    io.to(updatedCase.guardian.toString()).emit('newNotification', notification);
                }
            }
        }

        req.flash('success', res.__('flash_case_updated'));
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getMediaCaseReview = async (req, res) => {
    try {
        const caseRecord = await Case.findById(req.params.id).populate('guardian', 'name email');
        if (!caseRecord) {
            req.flash('error', res.__('flash_case_not_found'));
            return res.redirect('/admin/cases-manager');
        }

        const role = req.user.role;
        const canOpen =
            (role === 'media' && caseRecord.status === 'media_review') ||
            (role === 'super_admin' && ['media_review', 'approved'].includes(caseRecord.status));

        if (!canOpen) {
            req.flash('error', res.__('admin_case_error_media_review_access'));
            return res.redirect('/admin/cases-manager');
        }

        const storyAr = caseRecord.details?.storyAr || '';
        const displayStory = storyAr || caseRecord.description || '';

        res.render('pages/admin/media-case-review', {
            title: res.__('admin_sidebar_media_cases'),
            caseRecord,
            displayStory,
            storyUsesDescriptionFallback: !storyAr && Boolean(caseRecord.description),
            canPublish: caseRecord.status === 'media_review' && (role === 'media' || role === 'super_admin'),
            isAlreadyPublished: caseRecord.status === 'approved'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.saveCaseMediaContent = async (req, res) => {
    const redirectTo = `/admin/cases/${req.params.id}/media-review`;
    const wantsJson = (req.headers.accept || '').includes('application/json')
        || (req.headers['content-type'] || '').includes('application/json');

    try {
        const existingCase = await Case.findById(req.params.id);
        if (!existingCase) {
            if (wantsJson) return res.status(404).json({ ok: false, error: 'not_found' });
            req.flash('error', res.__('flash_case_not_found'));
            return res.redirect('/admin/cases-manager');
        }

        if (!(await assertMediaContentAccess(req, res, existingCase))) return;

        const fields = readMediaTextFields(req);
        if (!fields.ok) {
            console.warn('Media content save missing fields', {
                caseId: String(existingCase._id),
                missing: fields.missing,
                bodyKeys: Object.keys(req.body || {})
            });
            const message = res.__('admin_media_case_save_incomplete') || 'لم تصل جميع حقول المحتوى إلى الخادم. يرجى المحاولة مرة أخرى.';
            if (wantsJson) return res.status(400).json({ ok: false, error: 'incomplete', missing: fields.missing });
            req.flash('error', message);
            return res.redirect(redirectTo);
        }

        const priorDetails = caseDetailsSnapshot(existingCase);
        const updateData = {
            title: fields.title,
            description: fields.description,
            details: {
                familyCount: priorDetails.familyCount,
                orphanCount: priorDetails.orphanCount,
                storyAr: fields.storyAr
            }
        };

        if (fields.storyVideo) {
            const normalized = await getPlayableStoryVideoUrlAsync(fields.storyVideo);
            if (!normalized) {
                if (wantsJson) return res.status(400).json({ ok: false, error: 'invalid_video' });
                req.flash('error', res.__('admin_media_story_video_invalid'));
                return res.redirect(redirectTo);
            }
            updateData.storyVideo = normalized;
        } else {
            updateData.storyVideo = '';
        }

        const contentCheck = await evaluateCaseContentFields({
            title: fields.title,
            description: fields.description,
            storyAr: fields.storyAr
        });
        if (!contentCheck.ok) {
            let message = res.__('flash_case_media_content_rejected') || 'لم يتم قبول النص. راجع المحتوى وحاول مجدداً.';
            if (contentCheck.code === 'forbidden_word') {
                const fieldLabel = res.__(`register_case_field_${contentCheck.field}`);
                message = res.__('flash_forbidden_word_in_field', { field: fieldLabel, word: contentCheck.word });
            } else if (contentCheck.code === 'copied_story') {
                message = res.__('flash_case_story_copied_example');
            } else if (contentCheck.code === 'copied_description') {
                message = res.__('flash_case_desc_copied_example');
            }
            if (wantsJson) return res.status(400).json({ ok: false, error: contentCheck.code, message });
            req.flash('error', message);
            return res.redirect(redirectTo);
        }

        await persistCaseDocumentUpdate(existingCase, updateData);
        const verified = await verifyPersistedCaseContent(existingCase._id, {
            title: fields.title,
            description: fields.description,
            storyAr: fields.storyAr
        });
        if (!verified.ok) {
            console.error('Media content save verification failed', {
                caseId: String(existingCase._id),
                reason: verified.reason
            });
            if (wantsJson) return res.status(500).json({ ok: false, error: verified.reason });
            req.flash('error', res.__('admin_media_case_save_verify_failed') || 'تعذّر تأكيد حفظ المحتوى في قاعدة البيانات. يرجى إعادة المحاولة.');
            return res.redirect(redirectTo);
        }

        await invalidatePublicCaseCaches(existingCase._id);
        await logActivity(req.user._id, 'case_update', 'Case', req.params.id, res.__('log_case_media_content_saved'));

        if (wantsJson) {
            return res.json({
                ok: true,
                redirect: `${redirectTo}?saved=1`,
                saved: {
                    title: verified.saved.title,
                    description: verified.saved.description,
                    storyAr: verified.saved.details?.storyAr || ''
                }
            });
        }

        req.flash('success', res.__('flash_case_media_content_saved'));
        res.redirect(`${redirectTo}?saved=1`);
    } catch (err) {
        console.error(err);
        if (wantsJson) return res.status(500).json({ ok: false, error: 'server_error' });
        res.status(500).send(res.__('error_server'));
    }
};

exports.saveCaseMediaAssets = async (req, res) => {
    try {
        const existingCase = await Case.findById(req.params.id);
        if (!existingCase) {
            req.flash('error', res.__('flash_case_not_found'));
            return res.redirect('/admin/cases-manager');
        }

        if (!(await assertMediaContentAccess(req, res, existingCase))) return;

        const updateData = {};

        let keptGallery = [];
        if (req.body.galleryKeep !== undefined) {
            keptGallery = Array.isArray(req.body.galleryKeep)
                ? req.body.galleryKeep
                : [req.body.galleryKeep];
        }
        const galFiles = req.files && req.files.gallery;
        const newGallery = galFiles && galFiles.length ? galFiles.map((f) => `/uploads/${f.filename}`) : [];
        if (req.body.galleryKeep !== undefined || (galFiles && galFiles.length)) {
            updateData.gallery = [...keptGallery, ...newGallery];
        }

        const imgFile = req.files && req.files.image && req.files.image[0];
        if (imgFile) updateData.image = `/uploads/${imgFile.filename}`;

        if (Object.keys(updateData).length === 0) {
            req.flash('error', res.__('admin_media_case_no_assets') || 'لم يتم اختيار أي صور للرفع.');
            return res.redirect(`/admin/cases/${req.params.id}/media-review`);
        }

        await persistCaseDocumentUpdate(existingCase, updateData);
        await invalidatePublicCaseCaches(existingCase._id);
        await logActivity(req.user._id, 'case_update', 'Case', req.params.id, res.__('log_case_media_assets_saved') || 'تحديث صور الحالة الإعلامية');

        req.flash('success', res.__('flash_case_media_assets_saved') || 'تم حفظ الصور بنجاح.');
        res.redirect(`/admin/cases/${req.params.id}/media-review`);
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.addCaseUpdate = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description } = req.body;
        const imagesUploads = req.files && req.files.length > 0 ? req.files.map(f => `/uploads/${f.filename}`) : [];

        const foundCase = await Case.findById(id);
        if (!foundCase) {
            req.flash('error', 'الحالة غير موجودة');
            return res.redirect('/admin/cases-manager');
        }

        foundCase.updates.push({
            title,
            content: description,
            images: imagesUploads,
            postedBy: 'admin',
            createdAt: new Date()
        });
        await foundCase.save();

        // Phase 2: Notify Followers
        if (foundCase.followers && foundCase.followers.length > 0) {
            const io = req.app.get('io');
            const notifications = foundCase.followers.map(followerId => ({
                recipient: followerId,
                sender: req.user._id,
                title: `تحديث جديد: ${foundCase.title}`,
                message: `تم إضافة تحديث جديد للحالة التي تتابعها: ${title}`,
                type: 'info',
                targetType: 'case_update',
                targetId: foundCase._id
            }));

            // Save all notifications to DB
            const savedNotifications = await Notification.insertMany(notifications);

            // Real-time notifications via Socket.io
            if (io) {
                savedNotifications.forEach(notif => {
                    io.to(notif.recipient.toString()).emit('newNotification', notif);
                });
            }
        }

        await logActivity(req.user._id, 'case_update', 'Case', id, `إضافة تحديث جديد للحالة: ${title}`);

        req.flash('success', res.__('flash_update_success'));
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.updateUserStatus = async (req, res) => {
    try {
        const { status, role } = req.body;
        const updateData = {};
        if (status) updateData.status = status;
        if (role && req.user.role === 'super_admin') updateData.role = role;

        const oldUser = await User.findById(req.params.id);

        if (oldUser.status === 'pending' && status === 'active') {
            updateData.activatedAt = new Date();
        }

        const updatedUser = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        
        // Phase 6: Notify user if activated
        if (oldUser.status === 'pending' && status === 'active') {
            const notification = await Notification.create({
                recipient: req.params.id,
                sender: req.user._id,
                title: res.__('notif_case_activated_title'),
                message: res.__('notif_case_activated_msg'),
                type: 'success',
                targetType: 'specific'
            });

            const io = req.app.get('io');
            if (io) {
                io.to(req.params.id.toString()).emit('newNotification', notification);
            }
        }

        // Determine record action and details
        let actionStr = 'user_moderate';
        let detailStr = `تم تحديث حالة المستخدم إلى ${status || 'no_change'} والدور إلى ${role || 'no_change'}`;

        if (oldUser.status === 'pending' && status === 'active') {
            actionStr = 'user_activate';
            detailStr = `تم تفعيل حساب المستخدم (المستفيد) بنجاح والموافقة على انضمامه للمنصة`;
        }

        await logActivity(req.user._id, actionStr, 'User', req.params.id, detailStr);

        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.json({ success: true, message: res.__('flash_update_success_json') });
        }

        req.flash('success', res.__('flash_user_updated'));
        res.redirect('/admin/users');
    } catch (err) {
        console.error(err);
        if (req.xhr || req.headers.accept.indexOf('json') > -1) {
            return res.status(500).json({ success: false, error: res.__('flash_error_update') });
        }
        req.flash('error', res.__('flash_error_update'));
        res.redirect('/admin/users');
    }
};


exports.hardDeleteCase = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'غير مصرح للقيام بهذا الإجراء' });
        }
        await Transaction.deleteMany({ case: req.params.id });
        await ChatRequest.deleteMany({ case: req.params.id });
        await Case.findByIdAndDelete(req.params.id);
        
        await logActivity(req.user._id, 'case_hard_delete', 'Case', req.params.id, 'تم حذف الحالة بشكل كامل نهائياً من النظام');
        req.flash('success', 'تم حذف الحالة بشكل كامل نهائياً من النظام');
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('error_server'));
        res.redirect('/admin/cases-manager');
    }
};

exports.toggleCaseVisibility = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'غير مصرح للقيام بهذا الإجراء' });
        }
        const foundCase = await Case.findById(req.params.id);
        if (!foundCase) {
            req.flash('error', 'الحالة غير موجودة');
            return res.redirect('/admin/cases-manager');
        }
        foundCase.isHidden = !foundCase.isHidden;
        await foundCase.save();
        
        const actDesc = foundCase.isHidden ? 'تم إخفاء الحالة عن العامة' : 'تم إظهار الحالة للعامة';
        await logActivity(req.user._id, 'case_visibility_toggle', 'Case', req.params.id, actDesc);
        req.flash('success', actDesc);
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('error_server'));
        res.redirect('/admin/cases-manager');
    }
};

exports.hardDeleteStory = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'غير مصرح للقيام بهذا الإجراء' });
        }
        const foundCase = await Case.findById(req.params.id);
        if (!foundCase) {
            req.flash('error', 'الحالة غير موجودة');
            return res.redirect('/admin/cases-manager');
        }
        foundCase.storyVideo = undefined;
        foundCase.isStoryHidden = false; // reset
        await foundCase.save();
        
        await logActivity(req.user._id, 'story_hard_delete', 'Case', req.params.id, 'تم حذف الفديو/الستوري التابع للحالة نهائياً');
        req.flash('success', 'تم حذف ستوري الحالة بنجاح');
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('error_server'));
        res.redirect('/admin/cases-manager');
    }
};

exports.toggleStoryVisibility = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'غير مصرح للقيام بهذا الإجراء' });
        }
        const foundCase = await Case.findById(req.params.id);
        if (!foundCase || !foundCase.storyVideo) {
            req.flash('error', 'الستوري غير موجود أو الحالة محذوفة');
            return res.redirect('/admin/cases-manager');
        }
        foundCase.isStoryHidden = !foundCase.isStoryHidden;
        await foundCase.save();
        
        const actDesc = foundCase.isStoryHidden ? 'تم منع الستوري من الظهور للعامة' : 'تم إظهار الستوري للعامة';
        await logActivity(req.user._id, 'story_visibility_toggle', 'Case', req.params.id, actDesc);
        req.flash('success', actDesc);
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('error_server'));
        res.redirect('/admin/cases-manager');
    }
};

exports.getCasesManager = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = {};
        if (req.user.role === 'media') {
            filter.status = 'media_review';
        } else if (status) {
            filter.status = status;
        }

        let cases = await Case.find(filter).sort({ createdAt: -1 });

        // Retroactively generate missing reference numbers for old cases
        let updated = false;
        for (let c of cases) {
            if (!c.referenceNumber) {
                c.referenceNumber = `JSR-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
                await c.save();
                updated = true;
            }
        }
        if (updated) cases = await Case.find(filter).sort({ createdAt: -1 });
        
        res.render('pages/admin/cases-manager', {
            title: res.__('admin_sidebar_cases_manager'),
            cases,
            currentStatus: status || 'all'
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getFieldReportPdf = async (req, res) => {
    try {
        const caseRecord = await Case.findById(req.params.id).populate({
            path: 'guardian',
            select: '-password -moderationNotes -blockedUsers'
        });
        if (!caseRecord) {
            req.flash('error', res.__('error_server')); // Generic missing case error
            return res.redirect('/admin/cases-manager');
        }

        // Retroactive fix for direct PDF generation of old cases
        if (!caseRecord.referenceNumber) {
            caseRecord.referenceNumber = `JSR-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
            await caseRecord.save();
        }

        res.render('pages/admin/field-report-pdf', {
            caseRecord,
            layout: false
        });
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('error_server'));
        res.redirect('/admin/cases-manager');
    }
};

exports.updateTransactionStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const transaction = await Transaction.findById(req.params.id);
        
        if (!transaction) {
            req.flash('error', res.__('flash_donation_not_found'));
            return res.redirect('/admin/dashboard');
        }

        if (status === 'verified' && transaction.status !== 'verified') {
            const foundCase = await Case.findById(transaction.case);
            if (foundCase) {
                foundCase.raisedAmount += transaction.amount;
                
                // Monthly sponsorship logic
                if (transaction.type === 'monthly') {
                    const expiryDate = new Date();
                    expiryDate.setDate(expiryDate.getDate() + 30);
                    foundCase.sponsorshipExpiryDate = expiryDate;
                    foundCase.currentSponsor = transaction.donor;
                }

                applyGoalReachedState(foundCase);
                await foundCase.save();
            }
        }

        transaction.status = status;
        transaction.verifiedBy = req.user._id;
        transaction.verifiedAt = new Date();
        await transaction.save();

        await logActivity(req.user._id, 'transaction_verify', 'Transaction', req.params.id, 
            `تم التأكد من التبرع (${transaction.type}) وتغيير حالته إلى ${status}`);

        req.flash('success', res.__('flash_donation_updated'));
        res.redirect('/admin/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_error_donation'));
        res.redirect('/admin/dashboard');
    }
};

exports.getDonationsLedger = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'super_admin') {
            return res.status(403).send('Forbidden');
        }

        const {
            from,
            to,
            status = 'verified',
            type = 'all',
            paymentMethod = 'all',
            disbursementStatus = 'all',
            isBankConfirmed = 'all',
            q = '',
            page = 1,
            limit = 50,
        } = req.query;

        const pageNum = Math.max(1, Number(page || 1));
        const limitNum = Math.max(10, Math.min(Number(limit || 50), 200));
        const skip = (pageNum - 1) * limitNum;

        const filters = { from, to, status, type, paymentMethod, disbursementStatus, isBankConfirmed };
        const search = safeRegex(q);

        const [result] = await Transaction.aggregate(
            buildDonationsLedgerPipeline({
                filters,
                search,
                includeTotalsFacet: true,
                skip,
                limit: limitNum
            })
        );

        const meta = result && result.meta ? result.meta : { count: 0 };
        const rows = (result && result.data) ? result.data : [];

        const totalCount = meta.count || 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / limitNum));

        const exportParams = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => {
            if (v !== undefined && v !== null && String(v).trim() !== '' && v !== 'all') exportParams.set(k, String(v));
        });
        if (String(q || '').trim()) exportParams.set('q', String(q).trim());

        res.render('pages/admin/donations-ledger', {
            title: res.__('admin_sidebar_donations_ledger'),
            rows,
            filters: { ...filters, q, page: pageNum, limit: limitNum },
            totals: {
                count: totalCount,
                sumAmount: meta.sumAmount || 0,
                sumInstitutionFee: meta.sumInstitutionFee || 0,
                sumGatewayFee: meta.sumGatewayFee || 0,
                sumOperationFee: meta.sumOperationFee || 0,
                sumTotalAmount: meta.sumTotalAmount || 0,
            },
            pagination: {
                page: pageNum,
                totalPages,
                totalCount,
                limit: limitNum
            },
            exportQueryString: exportParams.toString(),
            fmtDate
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء تحميل سجل التبرعات');
        return res.redirect('/admin/dashboard');
    }
};

exports.exportDonationsLedger = async (req, res) => {
    try {
        if (!req.user || req.user.role !== 'super_admin') {
            return res.status(403).send('Forbidden');
        }

        const {
            from,
            to,
            status = 'all',
            type = 'all',
            paymentMethod = 'all',
            disbursementStatus = 'all',
            isBankConfirmed = 'all',
            q = '',
        } = req.query;

        const filters = { from, to, status, type, paymentMethod, disbursementStatus, isBankConfirmed };
        const search = safeRegex(q);

        // Export cap to avoid memory blowups.
        const exportLimit = 10000;
        const docs = await Transaction.aggregate([
            ...buildDonationsLedgerPipeline({ filters, search, includeTotalsFacet: false, skip: 0, limit: exportLimit }),
        ]);

        const payload = docs && docs[0] ? docs[0] : { data: [], meta: { count: 0 } };
        const rows = payload.data || [];

        const headers = [
            '#',
            'رقم المعاملة',
            'التاريخ',
            'الحالة',
            'نوع التبرع',
            'وسيلة الدفع',
            'المتبرع',
            'البريد',
            'الحالة المستفيدة',
            'الفريق',
            'قيمة التبرع الأساسية ($)',
            'رسوم Stripe (معلوماتية — ليست في البنك) ($)',
            'رسوم المؤسسة (متوقعة في البنك) ($)',
            'إجمالي رسوم التشغيل عند الدفع ($)',
            'الإجمالي المحصل ($)',
            'نسبة التشغيل (%)',
            'Stripe Session',
            'Stripe PaymentIntent',
            'تم التدقيق بواسطة',
            'تاريخ التدقيق',
            'مطابق بنكياً',
            'حالة الصرف'
        ];

        const excelRows = rows.map((t, i) => [
            i + 1,
            t._idShort || String(t._idStr || t._id || '').slice(-8).toUpperCase(),
            fmtDate(t.createdAt),
            t.status || '—',
            t.type || '—',
            t.paymentMethod || '—',
            t.donorName || '—',
            t.donorEmail || '—',
            t.caseTitle || '—',
            t.teamName || '—',
            Number(t.amount || 0),
            Number(t.gatewayFee || 0),
            Number(t.institutionFee || 0),
            Number(t.operationFee || 0),
            Number(t.totalAmount || 0),
            Number(t.operationPercentage || 0),
            t.stripeSessionId || '—',
            t.stripePaymentIntentId || '—',
            t.verifiedBy ? String(t.verifiedBy) : '—',
            fmtDate(t.verifiedAt),
            t.isBankConfirmed === true ? 'نعم' : 'لا',
            t.disbursementStatus || '—'
        ]);

        const label = from && to ? `${from}_to_${to}` : 'full';
        const colWidths = [40, 110, 140, 90, 90, 140, 180, 220, 260, 160, 130, 130, 130, 140, 140, 120, 200, 220, 180, 140, 90, 110];

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="donations-ledger-${label}.xls"`);
        return res.send(buildExcel('سجل التبرعات', headers, excelRows, colWidths));
    } catch (err) {
        console.error(err);
        return res.status(500).send('Export error');
    }
};

exports.toggleCaseSatisfaction = async (req, res) => {
    try {
        if (req.user.role === 'media') {
            req.flash('error', res.__('error_forbidden') || 'غير مصرح');
            return res.redirect('/admin/cases-manager');
        }

        const { id } = req.params;
        const foundCase = await Case.findById(id);
        
        if (!foundCase) {
            req.flash('error', 'الحالة غير موجودة');
            return res.redirect('/admin/cases-manager');
        }

        if (foundCase.satisfiedBy === 'admin') {
            if (hasReachedFundingGoal(foundCase)) {
                foundCase.isSatisfied = true;
                foundCase.satisfiedBy = 'goal_reached';
                foundCase.status = 'completed';
            } else {
                foundCase.isSatisfied = false;
                foundCase.satisfiedBy = 'none';
            }
            if (foundCase.status === 'fully_sponsored') {
                foundCase.status = 'completed';
            }
        } else {
            foundCase.isSatisfied = true;
            foundCase.satisfiedBy = 'admin';
        }

        await foundCase.save();

        const donationsClosed = foundCase.satisfiedBy === 'admin';
        const statusText = donationsClosed ? res.__('case_satisfied_yes') : res.__('case_satisfied_no');
        await logActivity(req.user._id, 'case_update', 'Case', id, 
            res.__('log_case_satisfied', { status: statusText }));

        // Notify Beneficiary (Guardian)
        if (foundCase.guardian) {
            const notification = await Notification.create({
                recipient: foundCase.guardian,
                sender: req.user._id,
                title: res.__('notif_case_satisfied_title'),
                message: donationsClosed ? res.__('notif_case_satisfied_msg') : res.__('notif_case_unsatisfied_msg'),
                type: donationsClosed ? 'success' : 'warning',
                targetType: 'specific',
                link: `/cases/${foundCase._id}`
            });

            const io = req.app.get('io');
            if (io) {
                io.to(foundCase.guardian.toString()).emit('newNotification', notification);
            }
        }

        req.flash('success', `${res.__('flash_satisfied_update')} (${statusText})`);
        
        // Redirect back to referer if available, otherwise to manager
        const referer = req.header('Referer');
        if (referer && referer.includes('/cases/')) {
            return res.redirect(referer);
        }
        res.redirect('/admin/cases-manager');
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getOperationFeesDetail = async (req, res) => {
    try {
        // Fetch all verified transactions that have an operation fee
        const transactions = await Transaction.find({ 
            status: 'verified',
            institutionFee: { $gt: 0 } 
        })
        .populate('donor', 'name email')
        .populate('case', 'title')
        .sort({ createdAt: -1 });

        const totalFees = transactions.reduce((acc, curr) => acc + (curr.institutionFee || 0), 0);

        res.render('pages/admin/operation-fees', {
            title: res.__('admin_fees_title'),
            transactions,
            totalFees
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};
exports.createAdmin = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            req.flash('error', res.__('flash_email_taken'));
            return res.redirect('/admin/users');
        }

        const allowedStaffRoles = ['admin', 'regulator', 'support', 'media'];
        const safeRole = allowedStaffRoles.includes(role) ? role : 'admin';

        const newUser = await User.create({
            name,
            email,
            password,
            role: safeRole,
            status: 'active',
            activatedAt: new Date()
        });

        await logActivity(req.user._id, 'user_create', 'User', newUser._id, 
            res.__('log_admin_created', { name, email }));

        req.flash('success', res.__('flash_admin_created'));
        res.redirect('/admin/users');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_error_admin'));
        res.redirect('/admin/users');
    }
};

exports.deleteUser = async (req, res) => {
    try {
        const userToDelete = await User.findById(req.params.id);
        
        if (!userToDelete) {
            req.flash('error', res.__('flash_user_not_found'));
            return res.redirect('/admin/users');
        }

        if (userToDelete.role === 'super_admin') {
            req.flash('error', res.__('flash_no_delete_super'));
            return res.redirect('/admin/users');
        }

        const mediaAssets = await hardDeleteUserCompletely(req.params.id);
        await purgeMediaAssets(mediaAssets);

        await logActivity(req.user._id, 'user_delete', 'User', req.params.id, 
            `تم حذف المستخدم نهائياً: ${userToDelete.name} (${userToDelete.role})`);

        req.flash('success', res.__('flash_user_deleted'));
        res.redirect('/admin/users');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_error_update'));
        res.redirect('/admin/users');
    }
};

exports.getChatMonitor = async (req, res) => {
    try {
        const approvedChats = await ChatRequest.find({ status: 'approved' })
            .populate('donor family case')
            .sort({ createdAt: -1 });

        res.render('pages/admin/chat-monitor', {
            title: res.__('admin_sidebar_chat_monitor'),
            chats: approvedChats
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getConversationMessages = async (req, res) => {
    try {
        const { requestId } = req.params;
        const messages = await Message.find({ chatRequest: requestId })
            .populate('sender receiver')
            .sort({ createdAt: 1 });

        const chatRequest = await ChatRequest.findById(requestId).populate('donor family case');

        res.json({
            success: true,
            messages,
            chatRequest
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: res.__('error_server') });
    }
};

exports.moderateUser = async (req, res) => {
    try {
        const { userId, action, note, targetUserId } = req.body;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ error: res.__('flash_user_not_found') });
        }

        if (action === 'hard_delete') {
            if (req.user.role !== 'super_admin') {
                return res.status(403).json({ error: res.__('admin_error_super_only') });
            }
            
            const session = await mongoose.startSession();
            session.startTransaction();
            let mediaAssets = [];
            try {
                mediaAssets = await hardDeleteUserCompletely(userId, session);
                
                await logActivity(req.user._id, 'user_hard_delete', 'User', userId, 
                    `إعدام إلكتروني - تم مسح المستخدم وكل ما يتعلق به من النظام نهائياً: ${note}`);
                    
                await session.commitTransaction();
                session.endSession();
                await purgeMediaAssets(mediaAssets);
                return res.json({ success: true, message: 'تم الإعدام الإلكتروني للمستخدم بنجاح', redirect: '/admin/all-users' });
            } catch (err) {
                await session.abortTransaction();
                session.endSession();
                console.error(err);
                return res.status(500).json({ error: res.__('flash_hard_delete_error') });
            }
        }

        // --- Role-Based Security Guards for Admin ---
        if (req.user.role === 'admin') {
            // 1. Prevent moderating admins/super_admins
            if (user.role === 'admin' || user.role === 'super_admin') {
                return res.status(403).json({ error: 'لا يملك المشرف صلاحية ممارسة الرقابة على طاقم الإدارة' });
            }

            // 2. Prevent restricted actions
            const restrictedActions = ['ban_global_comm', 'soft_delete']; // hard_delete is handled above
            if (restrictedActions.includes(action)) {
                return res.status(403).json({ error: 'عذراً، لا تملك صلاحية تنفيذ هذا النوع من العقوبات الشاملة' });
            }
        }
        // --------------------------------------------

        const moderationNote = {
            admin: req.user._id,
            note,
            type: action,
            createdAt: new Date()
        };

        user.moderationNotes.push(moderationNote);

        if (action === 'ban') {
            user.status = 'suspended';
        } else if (action === 'warning') {
            user.warningsCount += 1;
        } else if (action === 'ban_user_specific' && targetUserId) {
            // Apply Mutual Block
            const getUserId = (b) => {
                const val = (b && b.user) ? b.user : b;
                return (val && val._id ? val._id : val).toString();
            };
            
            // 1. Block for current moderated user
            const alreadyBlockedInUser = user.blockedUsers.find(b => getUserId(b) === targetUserId.toString());
            if (!alreadyBlockedInUser) {
                user.blockedUsers.push({ user: targetUserId, reason: note });
                user.markModified('blockedUsers');
            }

            // 2. Block for the target party as well (Mutual)
            const targetUser = await User.findById(targetUserId);
            if (targetUser) {
                const alreadyBlockedInTarget = targetUser.blockedUsers.find(b => getUserId(b) === userId.toString());
                if (!alreadyBlockedInTarget) {
                    targetUser.blockedUsers.push({ user: userId, reason: note });
                    targetUser.markModified('blockedUsers');
                    await targetUser.save();
                }
            }
        } else if (action === 'ban_global_comm') {
            user.globalCommBan = true;
            user.globalCommBanReason = note;
        } else if (action === 'soft_delete') {
            user.isSoftDeleted = true;
            user.status = 'suspended';
            user.softDeleteReason = note;
            
            // Note: We don't delete other records here anymore, 
            // as this is a "Soft" delete that can be undone.
            // But we should ensure they are not visible in general lists.
        } else if (action === 'undo_warning') {
            user.warningsCount = Math.max(0, user.warningsCount - 1);
        } else if (action === 'undo_ban_global_comm') {
            user.globalCommBan = false;
            user.globalCommBanReason = null;
        } else if (action === 'undo_ban_user_specific' && targetUserId) {
            // Apply Mutual Undo
            const getUserId = (b) => {
                const val = (b && b.user) ? b.user : b;
                return (val && val._id ? val._id : val).toString();
            };
            
            // 1. Remove from current user
            user.blockedUsers = user.blockedUsers.filter(b => getUserId(b) !== targetUserId.toString());
            user.markModified('blockedUsers');

            // 2. Remove from the target party as well (Mutual)
            const targetUser = await User.findById(targetUserId);
            if (targetUser) {
                targetUser.blockedUsers = targetUser.blockedUsers.filter(b => getUserId(b) !== userId.toString());
                targetUser.markModified('blockedUsers');
                await targetUser.save();
            }
        } else if (action === 'undo_soft_delete') {
            user.isSoftDeleted = false;
            user.status = 'active';
            user.softDeleteReason = null;
        }

        await user.save();

        // 3. Automated Notification
        const isUndo = action.startsWith('undo_');
        const notificationMessage = isUndo 
            ? `بشرى سارة: تم رفع الإجراء الرقابي (${action}) عن حسابك بقرار إداري.`
            : `تم اتخاذ إجراء (${action}) بحق حسابك. التفاصيل: ${note}`;

        const notification = await Notification.create({
            recipient: userId,
            sender: req.user._id,
            title: isUndo ? 'إبلاغ برفع عقوبة إدارية' : 'تنبيه إداري جديد',
            message: notificationMessage,
            type: isUndo ? 'success' : (action === 'warning' ? 'warning' : 'danger'),
            targetType: 'specific'
        });

        // Real-time Emit
        const io = req.app.get('io');
        if (io) {
            io.to(userId.toString()).emit('newNotification', notification);
        }

        await logActivity(req.user._id, 'user_moderate', 'User', userId, 
            `إجراء رقابي (${action}): ${note}`);

        res.json({ success: true, message: isUndo ? 'تم إلغاء العقوبة وإبلاغ المستخدم بنجاح' : 'تم تنفيذ الإجراء الرقابي وإبلاغ المستخدم بنجاح' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: res.__('error_server') });
    }
};

exports.getAnalytics = async (req, res) => {
    try {
        const now = new Date();
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
        twelveMonthsAgo.setDate(1); // Start of month

        // 1. Overview KPIs
        const totalRaisedRaw = await Transaction.aggregate([
            { $match: { status: 'verified' } },
            { $group: { _id: null, total: { $sum: "$amount" }, fees: { $sum: { $ifNull: ["$institutionFee", 0] } }, count: { $sum: 1 } } }
        ]);
        const kpis = totalRaisedRaw[0] || { total: 0, fees: 0, count: 0 };

        const activeSponsorships = await Transaction.countDocuments({ type: 'monthly', status: 'verified' });
        const satisfiedCasesCount = await Case.countDocuments({ isSatisfied: true });
        const totalCases = await Case.countDocuments();
        const satisfactionRate = totalCases > 0 ? ((satisfiedCasesCount / totalCases) * 100).toFixed(1) : 0;

        // 2. Financial Trends (Last 12 Months)
        const financialTrends = await Transaction.aggregate([
            { $match: { status: 'verified', createdAt: { $gte: twelveMonthsAgo } } },
            { 
                $group: { 
                    _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } },
                    total: { $sum: "$amount" },
                    count: { $sum: 1 }
                } 
            },
            { $sort: { "_id.year": 1, "_id.month": 1 } }
        ]);

        // 3. User Demographics & Growth
        const userRoleDistribution = await User.aggregate([
            { $group: { _id: "$role", count: { $sum: 1 } } }
        ]);
        const userStatusDistribution = await User.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        // 4. Case Analytics (Type, Location, Status)
        const casesByType = await Case.aggregate([
            { $group: { _id: "$type", count: { $sum: 1 } } }
        ]);
        const casesByLocation = await Case.aggregate([
            { $group: { _id: "$location", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);
        const casesByStatus = await Case.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        // 5. Top 10 Donors (By Volume)
        const topDonors = await Transaction.aggregate([
            { $match: { status: 'verified' } },
            { $group: { _id: "$donor", totalDonated: { $sum: "$amount" }, count: { $sum: 1 } } },
            { $sort: { totalDonated: -1 } },
            { $limit: 10 },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'donorDetails'
                }
            },
            { $unwind: "$donorDetails" }
        ]);

        // 6. Communication & Efficiency
        const chatReqStats = await ChatRequest.aggregate([
            { $group: { _id: "$status", count: { $sum: 1 } } }
        ]);

        // 7. Recent Platform Activity Volume (Last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(now.getDate() - 30);
        const activityVol = await ActivityLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });

        const CaseUpdate = require('../models/CaseUpdate');
        const pendingImpactProofs = await CaseUpdate.find({ status: 'pending' })
            .populate('case', 'title')
            .populate('guardian', 'name')
            .sort({ createdAt: -1 })
            .limit(3);
        const [pendingImpactProofsCount, approvedImpactProofsCount, rejectedImpactProofsCount] = await Promise.all([
            CaseUpdate.countDocuments({ status: 'pending' }),
            CaseUpdate.countDocuments({ status: 'approved' }),
            CaseUpdate.countDocuments({ status: 'rejected' })
        ]);
        const impactWorkflowStats = {
            pending: pendingImpactProofsCount,
            approved: approvedImpactProofsCount,
            rejected: rejectedImpactProofsCount,
            total: pendingImpactProofsCount + approvedImpactProofsCount + rejectedImpactProofsCount
        };

        res.render('pages/admin/analytics', {
            title: res.__('admin_sidebar_analytics'),
            pendingImpactProofs,
            pendingImpactProofsCount,
            impactWorkflowStats,
            stats: {
                kpis,
                activeSponsorships,
                satisfactionRate,
                financialTrends,
                userRoleDistribution,
                userStatusDistribution,
                casesByType,
                casesByLocation,
                casesByStatus,
                topDonors,
                chatReqStats,
                activityVol
            }
        });
    } catch (err) {
        console.error('Analytics Error:', err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getActivityLogs = async (req, res) => {
    try {
        const { search, action, userId, startDate, endDate } = req.query;
        let query = {};

        // 1. Action Filter
        if (action && action !== 'all') {
            if (action === 'impact_proof') {
                query.action = { $in: ['case_update_submit', 'impact_proof_approve', 'impact_proof_reject'] };
            } else if (action === 'escalation') {
                query.action = { $in: ['admin_escalation_request', 'admin_escalation_approved', 'admin_escalation_rejected'] };
            } else {
                query.action = action;
            }
        }

        // 2. User ID Filter
        if (userId) {
            query.user = userId;
        }

        // 3. Date Range Filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) {
                const end = new Date(endDate);
                end.setHours(23, 59, 59, 999);
                query.createdAt.$lte = end;
            }
        }

        // 4. Advanced Search (User Name/Email or Details)
        if (search) {
            // Find users matching search term
            const users = await User.find({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }).select('_id');

            const userIds = users.map(u => u._id);

            query.$or = [
                { user: { $in: userIds } },
                { details: { $regex: search, $options: 'i' } },
                { targetType: { $regex: search, $options: 'i' } }
            ];
            
            if (search.match(/^[0-9a-fA-F]{24}$/)) {
                query.$or.push({ targetId: search });
            }
        }

        const logs = await ActivityLog.find(query)
            .populate('user', 'name email role avatar')
            .sort({ createdAt: -1 })
            .limit(200);

        res.render('pages/admin/activity-logs', {
            title: res.__('admin_sidebar_activity_logs'),
            logs,
            query: { search, action, userId, startDate, endDate }
        });
    } catch (err) {
        console.error('Activity Logs Error:', err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getAllUsers = async (req, res) => {
    try {
        const { role, caseType, status, donorType } = req.query;
        const publicUserRoles = ['donor', 'beneficiary', 'family', 'guardian'];
        let query = {};

        if (role === 'beneficiary') {
            query.role = { $in: ['beneficiary', 'family', 'guardian'] };
        } else if (role === 'donor') {
            query.role = 'donor';
        } else {
            query.role = { $in: publicUserRoles };
        }
        
        if (status && status !== 'all') {
            query.status = status;
        }

        // Handle caseType filtering for beneficiaries
        if (caseType && caseType !== 'all') {
            const matchingCases = await Case.find({ type: caseType }).select('guardian');
            const guardianIds = matchingCases.map(c => c.guardian).filter(id => id);
            query._id = { $in: guardianIds };
        }

        const users = await User.find(query).sort({ createdAt: -1 });
        
        // Enhance users with their case info and computing verification on the fly
        let enhancedUsers = await Promise.all(users.map(async (user) => {
            const userData = user.toObject();
            if (['beneficiary', 'family', 'guardian'].includes(userData.role)) {
                userData.case = await Case.findOne({ guardian: user._id });
            }
            if (userData.role === 'donor') {
                const donationCount = await Transaction.countDocuments({ donor: user._id, status: 'verified' });
                userData.isVerifiedDonor = donationCount > 0;
            }
            return userData;
        }));

        // In-memory filter for specialized donor type
        if (donorType && donorType !== 'all') {
            enhancedUsers = enhancedUsers.filter(u => 
                u.role === 'donor' && 
                (donorType === 'verified' ? u.isVerifiedDonor : !u.isVerifiedDonor)
            );
        }

        res.render('pages/admin/all-users', {
            title: res.__('admin_sidebar_all_users'),
            users: enhancedUsers,
            filters: { role: role || 'all', caseType: caseType || 'all', status: status || 'all', donorType: donorType || 'all' }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getNotificationsManager = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const skip = (page - 1) * limit;

        const notifications = await Notification.find()
            .populate('sender', 'name role avatar')
            .populate('recipient', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Notification.countDocuments();
        
        // Fetch users for the "Specific User" dropdown
        const users = await User.find({ status: 'active' }).select('name email role').sort({ name: 1 });

        res.render('pages/admin/notifications/manage', {
            title: res.__('admin_notif_manage_link'),
            notifications,
            users,
            currentPage: page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getUserOversight = async (req, res) => {
    try {
        const userId = req.params.id;
        const user = await User.findById(userId);
        if (!user) {
            req.flash('error', 'المستخدم غير موجود');
            return res.redirect('/admin/all-users');
        }

        // Vertial Separation: Admins cannot view other admins/super_admins hub
        if (req.user.role === 'admin' && (user.role === 'admin' || user.role === 'super_admin')) {
            req.flash('error', 'غير مسموح للمشرفين بالوصول لبيانات الإدارة');
            return res.redirect('/admin/all-users');
        }

        let oversightUser = user.toObject();
        if (oversightUser.role === 'donor') {
            const donationCount = await Transaction.countDocuments({ donor: oversightUser._id, status: 'verified' });
            oversightUser.isVerifiedDonor = donationCount > 0;
        }

        const [
            cases,
            donationsMade,
            casesReceivedRaw
        ] = await Promise.all([
            Case.find({ guardian: userId }).sort({ createdAt: -1 }),
            Transaction.find({ donor: userId, status: 'verified' }).populate('case').sort({ createdAt: -1 }),
            Case.find({ guardian: userId }).select('_id')
        ]);

        let donationsReceived = [];
        if (casesReceivedRaw.length > 0) {
            const caseIds = casesReceivedRaw.map(c => c._id);
            donationsReceived = await Transaction.find({ case: { $in: caseIds }, status: 'verified' })
                .populate('donor', 'name')
                .populate('case', 'title type')
                .sort({ createdAt: -1 });
        }

        const rawChatHistory = await Message.find({
            $or: [
                { sender: userId },
                { receiver: userId }
            ]
        })
        .populate('sender', 'name role avatar status moderationNotes')
        .populate('receiver', 'name role avatar status moderationNotes')
        .populate('case', 'title')
        .sort({ createdAt: 1 });

        const conversationsMap = new Map();
        
        rawChatHistory.forEach(msg => {
            const isSender = msg.sender && msg.sender._id.toString() === userId;
            const otherUser = isSender ? msg.receiver : msg.sender;
            
            if (!otherUser) return; 

            // Group by the interaction partner
            const threadId = otherUser._id.toString();
            
            if (!conversationsMap.has(threadId)) {
                conversationsMap.set(threadId, {
                    partner: otherUser,
                    messages: [],
                    lastActivity: msg.createdAt
                });
            }
            
            conversationsMap.get(threadId).messages.push(msg);
            conversationsMap.get(threadId).lastActivity = msg.createdAt;
        });

        const discussions = Array.from(conversationsMap.values()).sort((a, b) => b.lastActivity - a.lastActivity);

        const totalDonatedAmount = donationsMade.reduce((sum, tx) => sum + tx.amount, 0);
        const totalReceivedAmount = donationsReceived.reduce((sum, tx) => sum + tx.amount, 0);

        res.render('pages/admin/user-oversight', {
            title: `رقابة شاملة: ${oversightUser.name}`,
            oversightUser: oversightUser,
            cases,
            donationsMade,
            donationsReceived,
            discussions,
            stats: {
                totalDonatedAmount,
                totalReceivedAmount
            }
        });

    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء تحميل بيانات الرقابة');
        res.redirect('/admin/all-users');
    }
};

exports.getPendingApprovals = async (req, res) => {
    try {
        const pendingUsers = await User.find({ status: 'pending' }).sort({ createdAt: -1 });
        
        res.render('pages/admin/pending-approvals', {
            title: res.__('admin_sidebar_pending_approvals'),
            users: pendingUsers
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

// Phase 11: Case Impact Proofs (Verified Updates)
exports.getPendingImpactProofs = async (req, res) => {
    try {
        const pendingProofs = await CaseUpdate.find({ status: 'pending' })
            .populate('case')
            .populate('guardian', 'name email')
            .sort({ createdAt: -1 });

        const [pending, approved, rejected] = await Promise.all([
            CaseUpdate.countDocuments({ status: 'pending' }),
            CaseUpdate.countDocuments({ status: 'approved' }),
            CaseUpdate.countDocuments({ status: 'rejected' })
        ]);

        res.render('pages/admin/pending-impact-proofs', {
            title: res.__('admin_sidebar_impact_proofs'),
            pendingProofs,
            impactWorkflowStats: { pending, approved, rejected, total: pending + approved + rejected }
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.approveImpactProof = async (req, res) => {
    try {
        const { id } = req.params;
        const proof = await CaseUpdate.findById(id).populate('case');

        if (!proof) {
            req.flash('error', 'الإثبات غير موجود');
            return res.redirect('/admin/pending-impact-proofs');
        }

        proof.status = 'approved';
        proof.approvedAt = new Date();
        await proof.save();

        const targetCase = await Case.findById(proof.case._id);
        targetCase.updates.push({
            title: proof.title,
            content: proof.content,
            images: proof.images,
            postedBy: 'family',
            createdAt: proof.createdAt
        });
        await targetCase.save();

        await Notification.create({
            recipient: proof.guardian,
            sender: req.user._id,
            title: 'تمت الموافقة على إثبات الأثر',
            message: `لقد تمت مراجعة والموافقة على إثبات الأثر الخاص بـ: ${targetCase.title}. تم نشره الآن للمتبرعين.`,
            type: 'success',
            targetType: 'case_update',
            targetId: targetCase._id
        });

        if (targetCase.followers && targetCase.followers.length > 0) {
            const notifications = targetCase.followers.map(f => ({
                recipient: f,
                sender: req.user._id,
                title: `إثبات أثر موثق: ${targetCase.title}`,
                message: `تم إضافة إثبات أثر موثق جديد (فواتير/صور) لحالة تتابعها: ${proof.title}`,
                type: 'info',
                targetType: 'case_update',
                targetId: targetCase._id
            }));
            await Notification.insertMany(notifications);
        }

        await logActivity(req.user._id, 'impact_proof_approve', 'CaseUpdate', id, `موافقة على إثبات أثر للحالة: ${targetCase.title}`);

        req.flash('success', 'تمت الموافقة على الإثبات ونشره بنجاح');
        const returnTo = sanitizeAdminReturnPath(req.body.returnTo, '/admin/pending-impact-proofs');
        res.redirect(returnTo);
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء معالجة الطلب');
        res.redirect('/admin/pending-impact-proofs');
    }
};

exports.rejectImpactProof = async (req, res) => {
    try {
        const { id } = req.params;
        const { rejectionReason } = req.body;
        const proof = await CaseUpdate.findById(id).populate('case');

        if (!proof) {
            req.flash('error', 'الإثبات غير موجود');
            return res.redirect('/admin/pending-impact-proofs');
        }

        proof.status = 'rejected';
        proof.rejectionReason = rejectionReason;
        await proof.save();

        await Notification.create({
            recipient: proof.guardian,
            sender: req.user._id,
            title: 'تم رفض إثبات الأثر',
            message: `عذراً، تعذر قبول إثبات الأثر لـ ${proof.case.title}. السبب: ${rejectionReason}`,
            type: 'danger',
            targetType: 'case_update',
            targetId: proof.case._id
        });

        await logActivity(req.user._id, 'impact_proof_reject', 'CaseUpdate', id, `رفض إثبات أثر للحالة: ${proof.case.title}. السبب: ${rejectionReason}`);

        req.flash('success', 'تم رفض الإثبات وإبلاغ الأسرة');
        const returnTo = sanitizeAdminReturnPath(req.body.returnTo, '/admin/pending-impact-proofs');
        res.redirect(returnTo);
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء معالجة الطلب');
        res.redirect('/admin/pending-impact-proofs');
    }
};

// ==========================================
// Phase 12: Admin Escalation Center (Hotline)
// ==========================================
exports.getEscalationsCenter = async (req, res) => {
    try {
        let requests;
        if (req.user.role === 'super_admin' || req.user.role === 'regulator') {
            // Super Admin and Regulator see ALL requests
            requests = await AdminRequest.find()
                .populate('requester targetUser targetCase resolvedBy')
                .sort({ createdAt: -1 });
        } else {
            // Regular Admin sees only THEIR requests
            requests = await AdminRequest.find({ requester: req.user._id })
                .populate('targetUser targetCase resolvedBy')
                .sort({ createdAt: -1 });
        }

        res.render('pages/admin/escalations-center', {
            title: res.__('admin_sidebar_escalations'),
            requests
        });
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء جلب الطلبات');
        res.redirect('/admin/dashboard');
    }
};

exports.submitAdminRequest = async (req, res) => {
    try {
        const { type, targetUser, targetCase, reason } = req.body;

        const newRequest = await AdminRequest.create({
            requester: req.user._id,
            type,
            targetUser: targetUser || null,
            targetCase: targetCase || null,
            reason
        });

        // Enhance Log Message with Target Details
        let targetLogInfo = '';
        if (targetUser) {
            const tUser = await User.findById(targetUser);
            if (tUser) targetLogInfo += ` للمستخدم (${tUser.name})`;
        }
        if (targetCase) {
            const tCase = await Case.findById(targetCase);
            if (tCase) targetLogInfo += ` للحالة (${tCase.title})`;
        }

        // Log Activity
        await logActivity(req.user._id, 'admin_escalation_request', 'AdminRequest', newRequest._id, 
            `تم رفع طلب للإدارة العليا بصلاحية (${type})${targetLogInfo} والسبب: ${reason}`);

        // Notify Super Admins
        const superAdmins = await User.find({ role: 'super_admin' });
        const notifications = superAdmins.map(sa => ({
            recipient: sa._id,
            sender: req.user._id,
            title: res.__('notif_escalation_title'),
            message: res.__('notif_escalation_msg', { name: req.user.name, type }),
            type: 'warning',
            targetType: 'escalation'
        }));

        const savedNotifs = await Notification.insertMany(notifications);
        const io = req.app.get('io');
        if (io) {
            savedNotifs.forEach(n => {
                io.to(n.recipient.toString()).emit('newNotification', n);
            });
        }

        req.flash('success', res.__('flash_escalation_success'));
        res.redirect('/admin/escalations');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_escalation_error'));
        res.redirect('/admin/escalations');
    }
};

exports.resolveAdminRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, reply } = req.body;

        const adminReq = await AdminRequest.findById(id).populate('targetUser targetCase requester');
        if (!adminReq) {
            req.flash('error', res.__('flash_request_not_found'));
            return res.redirect('/admin/escalations');
        }

        if (adminReq.status !== 'pending') {
            req.flash('error', res.__('flash_request_already_resolved'));
            return res.redirect('/admin/escalations');
        }

        adminReq.status = action; // 'approved' or 'rejected'
        adminReq.superAdminReply = reply;
        adminReq.resolvedBy = req.user._id;
        adminReq.resolvedAt = new Date();

        let actionLogMsg = '';

        if (action === 'approved') {
            // Execute the highly privileged action
            if (adminReq.type === 'hard_delete_user' && adminReq.targetUser) {
                const userId = adminReq.targetUser._id;
                const mediaAssets = await hardDeleteUserCompletely(userId);
                await purgeMediaAssets(mediaAssets);
                
                actionLogMsg = res.__('log_escalation_approved_hard_delete');
            } else {
                actionLogMsg = res.__('log_escalation_approved_generic');
            }
        } else {
            actionLogMsg = res.__('log_escalation_rejected', { reply });
        }

        await adminReq.save();

        // Enhance Log Message with Target Details
        let targetLogInfo = '';
        if (adminReq.targetUser) targetLogInfo += ` للمستخدم (${adminReq.targetUser.name})`;
        if (adminReq.targetCase) targetLogInfo += ` للحالة (${adminReq.targetCase.title})`;

        // 1. Log Activity
        const decisionStr = action === 'approved' ? res.__('common_decision_approved') : res.__('common_decision_rejected');
        await logActivity(req.user._id, `admin_escalation_${action}`, 'AdminRequest', adminReq._id, 
            `ADMIN ESCALATION (${adminReq.requester.name})${targetLogInfo} | القرار: ${decisionStr} - ${actionLogMsg}`);

        // 2. Notify the Requesting Admin
        const notif = await Notification.create({
            recipient: adminReq.requester._id,
            sender: req.user._id,
            title: res.__('notif_escalation_resolved_title', { status: action === 'approved' ? res.__('common_accepted') : res.__('common_refused') }),
            message: res.__('notif_escalation_resolved_msg', { type: adminReq.type, reply: reply || actionLogMsg }),
            type: action === 'approved' ? 'success' : 'error',
            targetType: 'escalation_resolved'
        });

        const io = req.app.get('io');
        if (io) {
            io.to(notif.recipient.toString()).emit('newNotification', notif);
        }

        const flashDecision = action === 'approved' ? res.__('common_accepted') : res.__('common_refused');
        req.flash('success', res.__('flash_request_resolved_success', { status: flashDecision }));
        res.redirect('/admin/escalations');
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء معالجة الطلب');
        res.redirect('/admin/escalations');
    }
};

exports.getPasswordRecovery = async (req, res) => {
    try {
        const search = (req.query.q || '').trim();
        let users = [];

        if (search.length >= 2) {
            const query = buildPasswordRecoverySearchQuery(search);
            users = await User.find(query)
                .select('name email idNumber role status mustChangePassword tempPasswordSetAt')
                .sort({ name: 1 })
                .limit(25);
        }

        res.render('pages/admin/password-recovery', {
            title: res.__('admin_sidebar_password_recovery'),
            users,
            search
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.issueTemporaryPassword = async (req, res) => {
    try {
        const { reason } = req.body;
        const target = await User.findById(req.params.id);

        if (!target) {
            return res.status(404).json({ success: false, message: res.__('flash_user_not_found') });
        }

        if (!PASSWORD_RECOVERY_ROLES.includes(target.role)) {
            return res.status(403).json({ success: false, message: res.__('admin_password_recovery_staff_blocked') });
        }

        if (target.role === 'super_admin') {
            return res.status(403).json({ success: false, message: res.__('admin_password_recovery_super_blocked') });
        }

        if (target.isSoftDeleted || target.status === 'suspended') {
            return res.status(400).json({ success: false, message: res.__('admin_password_recovery_account_inactive') });
        }

        const trimmedReason = (reason || '').trim();
        if (trimmedReason.length < 10) {
            return res.status(400).json({ success: false, message: res.__('admin_password_recovery_reason_required') });
        }

        const tempPassword = generateTempPassword();

        target.password = tempPassword;
        target.mustChangePassword = true;
        target.tempPasswordSetAt = new Date();
        target.tempPasswordSetBy = req.user._id;
        target.tempPasswordReason = trimmedReason;
        target.passwordResetToken = undefined;
        target.passwordResetExpires = undefined;
        await target.save({ validateBeforeSave: false });

        await logActivity(
            req.user._id,
            'password_temp_issue',
            'User',
            target._id,
            `إصدار كلمة مرور مؤقتة للمستخدم ${target.name} (${target.email}) — السبب: ${trimmedReason}`
        );

        const loginHint = target.idNumber
            ? res.__('admin_password_recovery_login_id_hint', { idNumber: target.idNumber })
            : res.__('admin_password_recovery_login_email_hint', { email: target.email });

        return res.json({
            success: true,
            tempPassword,
            userName: target.name,
            loginHint
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ success: false, message: res.__('admin_password_recovery_issue_error') });
    }
};

const Transaction = require('../models/Transaction');
const Case = require('../models/Case');
const ChatRequest = require('../models/ChatRequest');
const Testimonial = require('../models/Testimonial');
const CaseUpdate = require('../models/CaseUpdate');
const { logActivity } = require('../utils/logger');

exports.getDashboard = async (req, res) => {
    try {
        const user = req.user;

        if (user.role === 'donor') {
            const transactions = await Transaction.find({ donor: user._id }).populate('case').sort({ createdAt: -1 });
            const totalDonated = transactions.reduce((acc, curr) => curr.status === 'verified' ? acc + curr.amount : acc, 0);
            
            // Phase 3: Detailed Sponsorship Hub data
            const activeSponsorships = await Transaction.find({ 
                donor: user._id, 
                type: 'monthly', 
                status: 'verified' 
            }).populate({
                path: 'case',
                populate: { path: 'updates' }
            }).sort({ createdAt: -1 });

            // Phase 3: My Fundraising Teams
            const Team = require('../models/Team');
            const myTeams = await Team.find({ creator: user._id }).populate('case');
            
            const approvedChats = await ChatRequest.find({ 
                donor: user._id, 
                status: 'approved' 
            }).populate('case family');

            // --- PREMIUM ADDITIONS START ---
            
            // 1. Donation Trends (Last 6 Months)
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            const trends = await Transaction.aggregate([
                { $match: { donor: user._id, status: 'verified', createdAt: { $gte: sixMonthsAgo } } },
                {
                    $group: {
                        _id: { month: { $month: "$createdAt" }, year: { $year: "$createdAt" } },
                        total: { $sum: "$amount" }
                    }
                },
                { $sort: { "_id.year": 1, "_id.month": 1 } }
            ]);

            // 4. Next Communication Window Logic
            const Setting = require('../models/Setting');
            const chatDaySett = await Setting.findOne({ key: 'chat_day' });
            const chatDay = chatDaySett ? chatDaySett.value : 'Monday';
            
            // --- PREMIUM ADDITIONS END ---

            return res.render('pages/donor/dashboard', { 
                title: res.__('donor_dashboard'),
                transactions,
                totalDonated,
                activeSponsorships,
                activeSponsorshipCounts: activeSponsorships.length,
                myTeams,
                approvedChats,
                myTestimonial: await Testimonial.findOne({ user: user._id }),
                // New Premium Data
                donationTrends: trends,
                chatDay,
                csrfToken: req.csrfToken()
            });
        }

        if (user.role === 'beneficiary' || user.role === 'family' || user.role === 'guardian') {
            const myCases = await Case.find({ guardian: user._id }).sort({ createdAt: -1 });
            const approvedChats = await ChatRequest.find({ 
                family: user._id, 
                status: 'approved' 
            }).populate('case donor');
            
            // 1. Next Communication Window Logic (Shared with Donor)
            const Setting = require('../models/Setting');
            const chatDaySett = await Setting.findOne({ key: 'chat_day' });
            const chatDay = chatDaySett ? chatDaySett.value : 'Monday';

            // 2. Aggregate Recent Activity
            // - Recent Verified Transactions
            const recentDonations = await Transaction.find({ 
                case: { $in: myCases.map(c => c._id) }, 
                status: 'verified' 
            }).populate('donor', 'name').sort({ createdAt: -1 }).limit(5);

            // - Recent Approved Chats
            const recentChats = approvedChats.slice(0, 3);

            const casesWithRecentDonations = await Promise.all(myCases.map(async (c) => {
                const recentTransactions = await Transaction.find({ case: c._id, status: 'verified' })
                    .populate('donor', 'name')
                    .sort({ createdAt: -1 })
                    .limit(5);
                return { ...c.toObject(), recentTransactions };
            }));

            // Fetch my submitted impact proofs
            const myUpdates = await CaseUpdate.find({ guardian: user._id }).populate('case').sort({ createdAt: -1 });

            return res.render('pages/family/dashboard', { 
                title: res.__('beneficiary_dashboard'),
                myCases: casesWithRecentDonations,
                myUpdates,
                approvedChats,
                recentDonations,
                recentChats,
                chatDay,
                csrfToken: req.csrfToken()
            });
        }

        if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'regulator') {
            return res.redirect('/admin/dashboard');
        }

        if (user.role === 'support') {
            return res.redirect('/support/admin/dashboard');
        }

        res.redirect('/');
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('flash_error_update'));
    }
};

exports.getCaseTransactions = async (req, res) => {
    try {
        const { id } = req.params;
        const foundCase = await Case.findById(id);

        if (!foundCase || foundCase.guardian.toString() !== req.user._id.toString()) {
            return res.status(403).json({ success: false, message: res.__('flash_unauthorized') });
        }

        const transactions = await Transaction.find({ case: id, status: 'verified' })
            .populate('donor', 'name')
            .sort({ createdAt: -1 });

        res.json({ success: true, transactions });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('flash_login_error') });
    }
};

exports.toggleCaseSatisfaction = async (req, res) => {
    try {
        const { id } = req.params;
        const foundCase = await Case.findById(id);

        if (!foundCase || foundCase.guardian.toString() !== req.user._id.toString()) {
            req.flash('error', res.__('flash_unauthorized_action'));
            return res.redirect('/dashboard');
        }

        if (foundCase.isSatisfied && foundCase.satisfiedBy === 'admin') {
            req.flash('error', req.getLocale() === 'ar' ? 'نأسف، تم إعلان الاكتفاء لهذه الحالة بقرار إداري. يرجى التواصل مع الإدارة لطلب إعادة التفعيل.' : 'Sorry, this case was marked as satisfied by administration. Please contact support to request reopening.');
            return res.redirect('/dashboard');
        }

        foundCase.isSatisfied = !foundCase.isSatisfied;
        foundCase.satisfiedBy = foundCase.isSatisfied ? 'guardian' : 'none';
        
        await foundCase.save();

        await logActivity(req.user._id, 'case_update', 'Case', id, 
            res.__('log_case_satisfied_toggle', { status: foundCase.isSatisfied ? res.__('common_satisfied') : res.__('common_receiving_donations') }));

        req.flash('success', res.__('flash_satisfied_updated', { status: foundCase.isSatisfied ? res.__('common_satisfied') : res.__('common_receiving_donations') }));
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('flash_error_update'));
    }
};

exports.getInvoice = async (req, res) => {
    try {
        const transaction = await Transaction.findById(req.params.id)
            .populate('case donor');

        if (!transaction) {
            req.flash('error', res.__('flash_donation_not_found'));
            return res.redirect('/dashboard');
        }

        // Check ownership
        if (transaction.donor._id.toString() !== req.user._id.toString()) {
            req.flash('error', res.__('flash_unauthorized_invoice'));
            return res.redirect('/dashboard');
        }

        res.render('pages/donor/invoice', {
            title: res.__('invoice_title', { id: transaction._id.toString().slice(-8).toUpperCase() }),
            transaction
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('flash_error_update'));
    }
};

// Phase 10: Testimonials
exports.updateTestimonial = async (req, res) => {
    try {
        const { content, rating, locationAr } = req.body;
        
        // Only donors can add testimonials
        if (req.user.role !== 'donor') {
            req.flash('error', res.__('flash_donors_only'));
            return res.redirect('/dashboard');
        }

        let testimonial = await Testimonial.findOne({ user: req.user._id });

        if (testimonial) {
            testimonial.content = content;
            testimonial.rating = rating || 5;
            testimonial.locationAr = locationAr;
            await testimonial.save();
        } else {
            testimonial = await Testimonial.create({
                user: req.user._id,
                content,
                rating: rating || 5,
                locationAr,
                status: 'approved'
            });
        }

        await logActivity(req.user._id, 'profile_update', 'Testimonial', testimonial._id, res.__('log_testimonial_update'));
        
        req.flash('success', res.__('flash_update_success_home'));
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_update_error'));
        res.redirect('/dashboard');
    }
};

// Phase 11: Proof of Impact (Case Updates)
exports.uploadProofOfImpact = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;
        
        // Handle Multer paths - ensure they are relative URLs for browser display
        const images = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

        const foundCase = await Case.findById(id);
        if (!foundCase || foundCase.guardian.toString() !== req.user._id.toString()) {
            req.flash('error', res.__('flash_unauthorized_action'));
            return res.redirect('/dashboard');
        }

        await CaseUpdate.create({
            case: id,
            guardian: req.user._id,
            title,
            content,
            images,
            status: 'pending'
        });

        await logActivity(req.user._id, 'case_update_submit', 'Case', id, res.__('log_proof_impact_submit', { title }));

        req.flash('success', res.__('flash_proof_success'));
        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_upload_error'));
        res.redirect('/dashboard');
    }
};

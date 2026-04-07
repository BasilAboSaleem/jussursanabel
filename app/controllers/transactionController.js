const Transaction = require('../models/Transaction');
const Case = require('../models/Case');
const Setting = require('../models/Setting');
const Team = require('../models/Team');
const Notification = require('../models/Notification');
const { logActivity } = require('../utils/logger');
const sendEmail = require('../utils/emailSender');
const { donationReceipt } = require('../utils/emailTemplates');

exports.getCheckout = async (req, res) => {
    try {
        const { case: caseId, type } = req.query;
        const foundCase = await Case.findById(caseId);
        
        if (!foundCase) {
            req.flash('error', 'الحالة غير موجودة');
            return res.redirect('/cases');
        }

        // 1. Check if Case is Satisfied
        if (foundCase.isSatisfied) {
            req.flash('error', res.__('flash_case_satisfied'));
            return res.redirect(`/cases/${caseId}`);
        }

        // 2. Check if Monthly Sponsorship is already taken
        if (type === 'monthly' && foundCase.sponsorshipExpiryDate && foundCase.sponsorshipExpiryDate > new Date()) {
            req.flash('error', res.__('flash_case_sponsored'));
            return res.redirect(`/cases/${caseId}`);
        }

        const amount = type === 'monthly' ? foundCase.monthlySponsorshipAmount : 50; // default 50 for direct

        // Fetch operation percentages
        const institutionSetting = await Setting.findOne({ key: 'institution_fee_percentage' });
        const gatewaySetting = await Setting.findOne({ key: 'gateway_fee_percentage' });
        
        const institutionPercentage = institutionSetting ? institutionSetting.value : 0;
        const gatewayPercentage = gatewaySetting ? gatewaySetting.value : 0;
        const operationPercentage = institutionPercentage + gatewayPercentage;

        res.render('pages/donations/checkout', { 
            title: type === 'monthly' ? res.__('checkout_title_monthly') : res.__('checkout_title_direct'),
            foundCase,
            type,
            amount,
            operationPercentage,
            institutionPercentage,
            gatewayPercentage,
            teamId: req.query.team || null,
            csrfToken: req.csrfToken()
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

exports.processDonation = async (req, res) => {
    try {
        const { caseId, amount, type, isAnonymous, encouragementMessage, teamId } = req.body;
        const foundCase = await Case.findById(caseId);

        if (!foundCase) {
            req.flash('error', res.__('flash_case_not_found'));
            return res.redirect('/cases');
        }

        // Backend Validations
        if (foundCase.isSatisfied) {
            req.flash('error', res.__('flash_case_satisfied_short'));
            return res.redirect(`/cases/${caseId}`);
        }

        if (type === 'monthly' && foundCase.sponsorshipExpiryDate && foundCase.sponsorshipExpiryDate > new Date()) {
            req.flash('error', res.__('flash_case_sponsored_short'));
            return res.redirect(`/cases/${caseId}`);
        }
        
        // Fetch current operation percentages
        const institutionSetting = await Setting.findOne({ key: 'institution_fee_percentage' });
        const gatewaySetting = await Setting.findOne({ key: 'gateway_fee_percentage' });
        
        const institutionPercentage = institutionSetting ? institutionSetting.value : 0;
        const gatewayPercentage = gatewaySetting ? gatewaySetting.value : 0;
        const operationPercentage = institutionPercentage + gatewayPercentage;
        
        const baseAmount = Number(amount);
        const institutionFee = (baseAmount * institutionPercentage) / 100;
        const gatewayFee = (baseAmount * gatewayPercentage) / 100;
        const operationFee = institutionFee + gatewayFee;
        
        let finalCaseAmount, totalAmountToCharge;
        const feeCovered = req.body.isFeeCovered === 'true' || req.body.isFeeCovered === true;

        if (feeCovered) {
            finalCaseAmount = baseAmount;
            totalAmountToCharge = baseAmount + operationFee;
        } else {
            finalCaseAmount = baseAmount - operationFee;
            totalAmountToCharge = baseAmount;
        }

        // Simulation of payment success
        const transaction = new Transaction({
            donor: req.user._id,
            case: caseId,
            amount: finalCaseAmount,
            institutionPercentage,
            gatewayPercentage,
            operationPercentage,
            institutionFee: institutionFee,
            gatewayFee: gatewayFee,
            operationFee: operationFee,
            totalAmount: totalAmountToCharge,
            type,
            status: 'verified', // Auto-verified in "Fake" gateway simulation
            paymentMethod: 'credit_card',
            verifiedAt: new Date(),
            verifiedBy: req.user._id, // Simulated system verification
            isAnonymous: !!isAnonymous,
            encouragementMessage: encouragementMessage,
            team: teamId || null
        });

        await transaction.save();

        // Increment team stats if applicable (Phase 3)
        if (teamId) {
            await Team.findByIdAndUpdate(teamId, {
                $inc: { totalRaised: finalCaseAmount, donorCount: 1 }
            });
        }

        // Update the case
        foundCase.raisedAmount += finalCaseAmount;
        
        // Update Sponsorship if type is monthly
        if (type === 'monthly') {
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + 30);
            foundCase.sponsorshipExpiryDate = expiryDate;
            foundCase.currentSponsor = req.user._id;
        }

        // Check if fully sponsored (for items with fixed targets)
        if (foundCase.targetAmount && foundCase.raisedAmount >= foundCase.targetAmount) {
            foundCase.status = 'fully_sponsored';
        }
        
        await foundCase.save();

        // Log the activity
        await logActivity(req.user._id, 'transaction_create', 'Transaction', transaction._id, 
            `تبرع ${type === 'monthly' ? 'كفالة شهرية' : 'مباشر'} بقيمة ${finalCaseAmount} ليرة للحالة: ${foundCase.title}`);

        // Notify Beneficiary (Guardian)
        if (foundCase.guardian) {
            const notification = await Notification.create({
                recipient: foundCase.guardian,
                sender: req.user._id,
                title: res.__('notif_donation_received_title'),
                message: res.__('notif_donation_received_msg', { amount: finalCaseAmount, title: foundCase.title }),
                type: 'success',
                targetType: 'specific',
                link: `/cases/${foundCase._id}`
            });

            const io = req.app.get('io');
            if (io) {
                io.to(foundCase.guardian.toString()).emit('newNotification', notification);
            }
        }

        // Send Donation Receipt Email
        try {
            await sendEmail({
                email: req.user.email,
                subject: 'إيصال تبرع - جسور سنابل',
                html: donationReceipt(req.user.name, finalCaseAmount, foundCase.title)
            });
        } catch (emailErr) {
            console.error('Failed to send receipt email:', emailErr);
        }

        req.flash('success', res.__('flash_donation_done'));
        res.redirect(`/cases/${caseId}`); 
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_donation_process_error'));
        res.redirect('/');
    }
};

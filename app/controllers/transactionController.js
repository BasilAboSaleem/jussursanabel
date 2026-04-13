const Transaction = require('../models/Transaction');
const Case = require('../models/Case');
const Setting = require('../models/Setting');
const Team = require('../models/Team');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { logActivity } = require('../utils/logger');
const sendEmail = require('../utils/emailSender');
const { donationReceipt } = require('../utils/emailTemplates');
const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || process.env.TEST_SECRET_KEY;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripeCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

const toMinorUnits = (value) => Math.round(Number(value || 0) * 100);

const verifyCaseIsDonatable = (foundCase, type) => {
    if (foundCase.isSatisfied || foundCase.status === 'fully_sponsored') {
        return { ok: false, key: 'flash_case_satisfied_short' };
    }
    if (type === 'monthly' && foundCase.sponsorshipExpiryDate && foundCase.sponsorshipExpiryDate > new Date()) {
        return { ok: false, key: 'flash_case_sponsored_short' };
    }
    return { ok: true };
};

const calculateFees = (baseAmount, institutionPercentage, gatewayPercentage, feeCovered) => {
    const institutionFee = (baseAmount * institutionPercentage) / 100;
    const gatewayFee = (baseAmount * gatewayPercentage) / 100;
    const operationFee = institutionFee + gatewayFee;

    const finalCaseAmount = feeCovered ? baseAmount : baseAmount - operationFee;
    const totalAmountToCharge = feeCovered ? baseAmount + operationFee : baseAmount;

    return {
        institutionFee,
        gatewayFee,
        operationFee,
        finalCaseAmount,
        totalAmountToCharge
    };
};

const finalizeVerifiedTransaction = async ({ transaction, foundCase, reqForLocale = null }) => {
    if (transaction.status === 'verified') return;

    transaction.status = 'verified';
    transaction.verifiedAt = new Date();
    await transaction.save();

    // Increment team stats once after successful payment
    if (transaction.team) {
        await Team.findByIdAndUpdate(transaction.team, {
            $inc: { totalRaised: transaction.amount, donorCount: 1 }
        });
    }

    foundCase.raisedAmount += transaction.amount;
    if (transaction.type === 'monthly') {
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 30);
        foundCase.sponsorshipExpiryDate = expiryDate;
        foundCase.currentSponsor = transaction.donor;
    }
    if (foundCase.targetAmount && foundCase.raisedAmount >= foundCase.targetAmount) {
        foundCase.status = 'fully_sponsored';
        foundCase.isSatisfied = true;
        foundCase.satisfiedBy = 'admin';
    }
    await foundCase.save();

    // Logging
    await logActivity(
        transaction.donor,
        'transaction_create',
        'Transaction',
        transaction._id,
        `تبرع ${transaction.type === 'monthly' ? 'كفالة شهرية' : 'مباشر'} بقيمة ${transaction.amount} للحالة: ${foundCase.title}`
    );

    // Notify beneficiary
    if (foundCase.guardian) {
        const notification = await Notification.create({
            recipient: foundCase.guardian,
            sender: transaction.donor,
            title: reqForLocale ? reqForLocale.__('notif_donation_received_title') : 'تم استلام تبرع جديد',
            message: reqForLocale
                ? reqForLocale.__('notif_donation_received_msg', { amount: transaction.amount, title: foundCase.title })
                : `تم استلام تبرع بقيمة ${transaction.amount} للحالة ${foundCase.title}`,
            type: 'success',
            targetType: 'specific',
            link: `/cases/${foundCase._id}`
        });

        if (reqForLocale && reqForLocale.app) {
            const io = reqForLocale.app.get('io');
            if (io) io.to(foundCase.guardian.toString()).emit('newNotification', notification);
        }
    }

    // Donation receipt email (best effort)
    try {
        const donor = await User.findById(transaction.donor).select("name email");
        if (donor && donor.email) {
            await sendEmail({
                email: donor.email,
                subject: 'إيصال تبرع - جسور سنابل',
                html: donationReceipt(donor.name || 'Donor', transaction.amount, foundCase.title)
            });
        }
    } catch (emailErr) {
        console.error('Failed to send receipt email:', emailErr);
    }
};

exports.getCheckout = async (req, res) => {
    try {
        const { case: caseId, type } = req.query;
        const foundCase = await Case.findById(caseId);
        
        if (!foundCase) {
            req.flash('error', 'الحالة غير موجودة');
            return res.redirect('/cases');
        }

        // 1. Check if Case is Satisfied
        if (foundCase.isSatisfied || foundCase.status === 'fully_sponsored') {
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
        if (!stripe) {
            req.flash('error', 'Stripe غير مهيأ على الخادم.');
            return res.redirect('/cases');
        }

        const { caseId, amount, type, isAnonymous, encouragementMessage, teamId } = req.body;
        const foundCase = await Case.findById(caseId);

        if (!foundCase) {
            req.flash('error', res.__('flash_case_not_found'));
            return res.redirect('/cases');
        }

        const donatableCheck = verifyCaseIsDonatable(foundCase, type);
        if (!donatableCheck.ok) {
            req.flash('error', res.__(donatableCheck.key));
            return res.redirect(`/cases/${caseId}`);
        }
        
        // Fetch current operation percentages
        const institutionSetting = await Setting.findOne({ key: 'institution_fee_percentage' });
        const gatewaySetting = await Setting.findOne({ key: 'gateway_fee_percentage' });
        
        const institutionPercentage = institutionSetting ? institutionSetting.value : 0;
        const gatewayPercentage = gatewaySetting ? gatewaySetting.value : 0;
        const operationPercentage = institutionPercentage + gatewayPercentage;
        
        const baseAmount = Number(amount);
        let finalCaseAmount, totalAmountToCharge;
        const feeCovered = req.body.isFeeCovered === 'true' || req.body.isFeeCovered === true;
        const feeCalc = calculateFees(baseAmount, institutionPercentage, gatewayPercentage, feeCovered);
        finalCaseAmount = feeCalc.finalCaseAmount;
        totalAmountToCharge = feeCalc.totalAmountToCharge;

        // Create pending transaction before redirecting to Stripe Checkout
        const transaction = new Transaction({
            donor: req.user._id,
            case: caseId,
            amount: finalCaseAmount,
            institutionPercentage,
            gatewayPercentage,
            operationPercentage,
            institutionFee: feeCalc.institutionFee,
            gatewayFee: feeCalc.gatewayFee,
            operationFee: feeCalc.operationFee,
            totalAmount: totalAmountToCharge,
            type,
            status: 'pending',
            paymentMethod: 'stripe_checkout',
            isAnonymous: !!isAnonymous,
            encouragementMessage: encouragementMessage,
            team: teamId || null
        });

        await transaction.save();
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            customer_email: req.user.email || undefined,
            success_url: `${process.env.BASE_URL}/donations/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.BASE_URL}/donations/cancel?transactionId=${transaction._id}`,
            metadata: {
                transactionId: String(transaction._id),
                caseId: String(caseId)
            },
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: stripeCurrency,
                        unit_amount: toMinorUnits(totalAmountToCharge),
                        product_data: {
                            name: foundCase.title || 'Donation',
                            description: type === 'monthly' ? 'Monthly Sponsorship' : 'Direct Donation'
                        }
                    }
                }
            ]
        });

        transaction.stripeSessionId = session.id;
        transaction.stripePaymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : undefined;
        await transaction.save();

        return res.redirect(303, session.url);
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_donation_process_error'));
        res.redirect('/');
    }
};

exports.handleCheckoutSuccess = async (req, res) => {
    try {
        req.flash('success', 'تم استلام عملية الدفع، يجري التحقق منها الآن.');
        return res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء العودة من بوابة الدفع.');
        return res.redirect('/dashboard');
    }
};

exports.handleCheckoutCancel = async (req, res) => {
    try {
        req.flash('error', 'تم إلغاء عملية الدفع قبل الإتمام.');
        return res.redirect('/cases');
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء إلغاء عملية الدفع.');
        return res.redirect('/cases');
    }
};

exports.handleStripeWebhook = async (req, res) => {
    if (!stripe || !stripeWebhookSecret) {
        return res.status(400).send('Stripe webhook is not configured');
    }

    const signature = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, signature, stripeWebhookSecret);
    } catch (err) {
        console.error('Stripe webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
            const session = event.data.object;
            const transactionId = session.metadata && session.metadata.transactionId;
            if (transactionId) {
                const transaction = await Transaction.findById(transactionId);
                if (transaction && transaction.status !== 'verified') {
                    const foundCase = await Case.findById(transaction.case);
                    if (foundCase) {
                        transaction.stripeSessionId = session.id || transaction.stripeSessionId;
                        if (typeof session.payment_intent === 'string') {
                            transaction.stripePaymentIntentId = session.payment_intent;
                        }
                        await transaction.save();

                        await finalizeVerifiedTransaction({ transaction, foundCase });
                    }
                }
            }
        }

        if (event.type === 'checkout.session.expired' || event.type === 'payment_intent.payment_failed') {
            const payload = event.data.object;
            let transaction = null;

            if (payload.metadata && payload.metadata.transactionId) {
                transaction = await Transaction.findById(payload.metadata.transactionId);
            } else if (payload.id) {
                transaction = await Transaction.findOne({
                    $or: [{ stripeSessionId: payload.id }, { stripePaymentIntentId: payload.id }]
                });
            }

            if (transaction && transaction.status === 'pending') {
                transaction.status = 'failed';
                await transaction.save();
            }
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        console.error('Stripe webhook handling failed:', err);
        return res.status(500).json({ received: false });
    }
};

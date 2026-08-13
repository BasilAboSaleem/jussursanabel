const Transaction = require('../models/Transaction');
const Case = require('../models/Case');
const Setting = require('../models/Setting');
const Team = require('../models/Team');
const User = require('../models/User');
const { logActivity, systemLogger } = require('../utils/logger');
const sendEmail = require('../utils/emailSender');
const { donationReceipt } = require('../utils/emailTemplates');
const { getStripeClient } = require('../utils/stripeConfig');
const {
    METADATA_SCHEMA_VERSION,
    buildStripeDonationMetadata,
    parseStripeDonationMetadata
} = require('../utils/stripeDonationMetadata');

const stripeCurrency = (process.env.STRIPE_CURRENCY || 'usd').toLowerCase();
const {
    collectWebhookSecrets,
    getStripeWebhookRawBody,
    constructStripeWebhookEvent,
    getWebhookSignatureHint,
} = require('../utils/stripeWebhook');
const { isDonationsClosed, applyGoalReachedState } = require('../utils/caseSatisfaction');

const toMinorUnits = (value) => Math.round(Number(value || 0) * 100);

const verifyCaseIsDonatable = (foundCase, type) => {
    if (isDonationsClosed(foundCase)) {
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

const applyVerifiedDonationEffects = async ({ transaction, foundCase }) => {
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
        if (transaction.donor) {
            foundCase.currentSponsor = transaction.donor;
        }
    }
    applyGoalReachedState(foundCase);
    await foundCase.save();

    if (transaction.donor) {
        await logActivity(
            transaction.donor,
            'transaction_create',
            'Transaction',
            transaction._id,
            `تبرع ${transaction.type === 'monthly' ? 'كفالة شهرية' : 'مباشر'} بقيمة ${transaction.amount} للحالة: ${foundCase.title}`
        );
    }

    try {
        let receiptEmail = null;
        let receiptName = 'Donor';

        if (transaction.isGuest) {
            receiptEmail = transaction.guestEmail;
            receiptName = transaction.guestName || 'متبرع زائر';
        } else if (transaction.donor) {
            const donor = await User.findById(transaction.donor).select('name email');
            if (donor && donor.email) {
                receiptEmail = donor.email;
                receiptName = donor.name || 'Donor';
            }
        }

        if (receiptEmail) {
            const emailResult = await sendEmail({
                email: receiptEmail,
                subject: 'إيصال تبرع — منصة نَمير',
                html: donationReceipt(receiptName, transaction.amount, foundCase.title),
                type: 'donation_receipt',
                immediate: true
            });
            if (!emailResult.ok) {
                systemLogger.warn('Donation receipt email not delivered', {
                    transactionId: String(transaction._id),
                    donorId: transaction.donor ? String(transaction.donor) : null,
                    guestEmail: transaction.guestEmail || null,
                    reason: emailResult.reason
                });
            }
        }
    } catch (emailErr) {
        systemLogger.error('Failed to send receipt email', { error: emailErr.message });
    }
};

const finalizeVerifiedTransaction = async ({ transaction, foundCase }) => {
    if (transaction.status === 'verified') {
        return;
    }

    transaction.status = 'verified';
    transaction.verifiedAt = new Date();
    await transaction.save();

    await applyVerifiedDonationEffects({ transaction, foundCase });
};

function isStripeCheckoutSessionPaid(session) {
    return session.payment_status === 'paid' || session.status === 'complete';
}

function resolvePaymentIntentId(sessionOrIntent) {
    if (!sessionOrIntent) return null;
    if (typeof sessionOrIntent === 'string') return sessionOrIntent;
    if (sessionOrIntent.payment_intent) {
        return typeof sessionOrIntent.payment_intent === 'string'
            ? sessionOrIntent.payment_intent
            : sessionOrIntent.payment_intent.id;
    }
    if (sessionOrIntent.id && sessionOrIntent.object === 'payment_intent') {
        return sessionOrIntent.id;
    }
    return null;
}

function resolveCheckoutCustomerDetails(session) {
    if (!session) return { email: '', name: '' };

    const details = session.customer_details || {};
    const email = String(details.email || session.customer_email || '').trim().toLowerCase();
    const name = String(details.name || '').trim();

    return { email, name };
}

async function findExistingStripeDonation({ stripeSessionId, paymentIntentId }) {
    const orConditions = [];
    if (stripeSessionId) orConditions.push({ stripeSessionId });
    if (paymentIntentId) orConditions.push({ stripePaymentIntentId: paymentIntentId });
    if (!orConditions.length) return null;

    return Transaction.findOne({ $or: orConditions });
}

async function createVerifiedDonationFromStripeMetadata(payload, {
    stripeSessionId,
    paymentIntentId,
    source = 'stripe_metadata'
} = {}) {
    const meta = parseStripeDonationMetadata(payload.metadata);
    if (!meta) {
        return { ok: false, reason: 'invalid_metadata' };
    }

    const existing = await findExistingStripeDonation({ stripeSessionId, paymentIntentId });
    if (existing) {
        if (existing.status === 'verified') {
            return { ok: true, alreadyVerified: true, transactionId: String(existing._id) };
        }
        if (existing.status === 'pending') {
            const foundCase = await Case.findById(existing.case);
            if (!foundCase) return { ok: false, reason: 'case_not_found' };
            if (stripeSessionId) existing.stripeSessionId = stripeSessionId;
            if (paymentIntentId) existing.stripePaymentIntentId = paymentIntentId;
            await existing.save();
            await finalizeVerifiedTransaction({ transaction: existing, foundCase });
            return { ok: true, verified: true, transactionId: String(existing._id) };
        }
    }

    const foundCase = await Case.findById(meta.caseId);
    if (!foundCase) {
        return { ok: false, reason: 'case_not_found' };
    }

    const donatableCheck = verifyCaseIsDonatable(foundCase, meta.type);
    if (!donatableCheck.ok) {
        systemLogger.warn('Stripe payment received but case no longer donatable', {
            source,
            caseId: meta.caseId,
            stripeSessionId
        });
        return { ok: false, reason: 'case_not_donatable' };
    }

    let transaction;
    try {
        const checkoutCustomer = payload.object === 'checkout.session'
            ? resolveCheckoutCustomerDetails(payload)
            : { email: '', name: '' };

        transaction = await Transaction.create({
            donor: meta.isGuest ? undefined : meta.donorId,
            isGuest: meta.isGuest,
            guestName: meta.isGuest
                ? (meta.guestName || checkoutCustomer.name || 'متبرع زائر')
                : undefined,
            guestEmail: meta.isGuest
                ? (meta.guestEmail || checkoutCustomer.email || undefined)
                : undefined,
            case: meta.caseId,
            amount: meta.amount,
            institutionPercentage: meta.institutionPercentage,
            gatewayPercentage: meta.gatewayPercentage,
            operationPercentage: meta.operationPercentage,
            institutionFee: meta.institutionFee,
            gatewayFee: meta.gatewayFee,
            operationFee: meta.operationFee,
            totalAmount: meta.totalAmount,
            type: meta.type,
            status: 'verified',
            verifiedAt: new Date(),
            paymentMethod: 'stripe_checkout',
            stripeSessionId: stripeSessionId || undefined,
            stripePaymentIntentId: paymentIntentId || undefined,
            isAnonymous: meta.isAnonymous,
            encouragementMessage: meta.encouragementMessage,
            team: meta.teamId || null
        });
    } catch (err) {
        if (err.code === 11000) {
            const dup = await findExistingStripeDonation({ stripeSessionId, paymentIntentId });
            if (dup && dup.status === 'verified') {
                return { ok: true, alreadyVerified: true, transactionId: String(dup._id) };
            }
        }
        throw err;
    }

    await applyVerifiedDonationEffects({ transaction, foundCase });

    systemLogger.info('Donation created after Stripe success', {
        source,
        transactionId: String(transaction._id),
        caseId: meta.caseId
    });

    return { ok: true, verified: true, transactionId: String(transaction._id) };
}

async function verifyDonationByTransactionId(transactionId, {
    stripeSessionId,
    paymentIntent,
    paymentIntentId,
    source = 'unknown'
} = {}) {
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
        return { ok: false, reason: 'transaction_not_found' };
    }
    if (transaction.status === 'verified') {
        return { ok: true, alreadyVerified: true, transactionId: String(transaction._id) };
    }

    const foundCase = await Case.findById(transaction.case);
    if (!foundCase) {
        return { ok: false, reason: 'case_not_found' };
    }

    if (stripeSessionId) {
        transaction.stripeSessionId = stripeSessionId;
    }
    const piId = paymentIntentId || resolvePaymentIntentId(paymentIntent);
    if (piId) {
        transaction.stripePaymentIntentId = piId;
    }
    await transaction.save();

    await finalizeVerifiedTransaction({ transaction, foundCase });

    systemLogger.info('Donation verified via Stripe (legacy pending record)', {
        source,
        transactionId: String(transaction._id),
        caseId: String(transaction.case)
    });

    return { ok: true, verified: true, transactionId: String(transaction._id) };
}

async function verifyDonationFromCheckoutSession(session, reqForLocale = null, source = 'checkout_session') {
    if (!isStripeCheckoutSessionPaid(session)) {
        return { ok: false, reason: 'not_paid' };
    }

    const paymentIntentId = resolvePaymentIntentId(session.payment_intent);
    const legacyTransactionId = session.metadata && session.metadata.transactionId;

    if (legacyTransactionId) {
        return verifyDonationByTransactionId(legacyTransactionId, {
            stripeSessionId: session.id,
            paymentIntent: session.payment_intent,
            reqForLocale,
            source
        });
    }

    return createVerifiedDonationFromStripeMetadata(session, {
        stripeSessionId: session.id,
        paymentIntentId,
        source
    });
}

async function cleanupAbandonedStripeDonation(payload) {
    const transactionId = payload.metadata && payload.metadata.transactionId;
    if (!transactionId) return;

    const deleted = await Transaction.deleteOne({
        _id: transactionId,
        status: 'pending',
        paymentMethod: 'stripe_checkout'
    });

    if (deleted.deletedCount) {
        systemLogger.info('Removed abandoned Stripe checkout donation record', { transactionId });
    }
}

exports.getCheckout = async (req, res) => {
    try {
        const { case: caseId, type } = req.query;
        const foundCase = await Case.findById(caseId);

        if (!foundCase) {
            req.flash('error', 'الحالة غير موجودة');
            return res.redirect('/cases');
        }

        if (isDonationsClosed(foundCase)) {
            req.flash('error', res.__('flash_case_satisfied'));
            return res.redirect(`/cases/${caseId}`);
        }

        if (type === 'monthly' && foundCase.sponsorshipExpiryDate && foundCase.sponsorshipExpiryDate > new Date()) {
            req.flash('error', res.__('flash_case_sponsored'));
            return res.redirect(`/cases/${caseId}`);
        }

        const amount = type === 'monthly' ? foundCase.monthlySponsorshipAmount : 50;

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
        const stripe = getStripeClient();
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

        const isGuestCheckout = !req.user;

        const donatableCheck = verifyCaseIsDonatable(foundCase, type);
        if (!donatableCheck.ok) {
            req.flash('error', res.__(donatableCheck.key));
            return res.redirect(`/cases/${caseId}`);
        }

        const institutionSetting = await Setting.findOne({ key: 'institution_fee_percentage' });
        const gatewaySetting = await Setting.findOne({ key: 'gateway_fee_percentage' });

        const institutionPercentage = institutionSetting ? institutionSetting.value : 0;
        const gatewayPercentage = gatewaySetting ? gatewaySetting.value : 0;
        const operationPercentage = institutionPercentage + gatewayPercentage;

        const baseAmount = Number(amount);
        const feeCovered = req.body.isFeeCovered === 'true' || req.body.isFeeCovered === true;
        const feeCalc = calculateFees(baseAmount, institutionPercentage, gatewayPercentage, feeCovered);
        const finalCaseAmount = feeCalc.finalCaseAmount;
        const totalAmountToCharge = feeCalc.totalAmountToCharge;

        const donationMetadata = buildStripeDonationMetadata({
            donorId: isGuestCheckout ? null : req.user._id,
            isGuest: isGuestCheckout,
            caseId,
            type,
            finalCaseAmount,
            totalAmount: totalAmountToCharge,
            institutionPercentage,
            gatewayPercentage,
            operationPercentage,
            institutionFee: feeCalc.institutionFee,
            gatewayFee: feeCalc.gatewayFee,
            operationFee: feeCalc.operationFee,
            isAnonymous: !!isAnonymous,
            encouragementMessage,
            teamId: teamId || null
        });

        const checkoutSessionParams = {
            mode: 'payment',
            success_url: `${process.env.BASE_URL}/donations/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.BASE_URL}/donations/cancel`,
            metadata: donationMetadata,
            payment_intent_data: {
                metadata: donationMetadata
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
        };

        if (!isGuestCheckout && req.user.email) {
            checkoutSessionParams.customer_email = req.user.email;
        }

        const session = await stripe.checkout.sessions.create(checkoutSessionParams);

        return res.redirect(303, session.url);
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_donation_process_error'));
        res.redirect('/');
    }
};

exports.handleCheckoutSuccess = async (req, res) => {
    try {
        const stripe = getStripeClient();
        const isGuestCheckout = !req.user;

        if (!stripe) {
            req.flash('error', 'Stripe غير مهيأ على الخادم.');
            return isGuestCheckout ? res.redirect('/cases') : res.redirect('/dashboard');
        }

        const { session_id: sessionId } = req.query;
        if (!sessionId) {
            req.flash('error', 'لم تكتمل عملية الدفع.');
            return isGuestCheckout ? res.redirect('/cases') : res.redirect('/dashboard');
        }

        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['payment_intent']
        });
        const result = await verifyDonationFromCheckoutSession(session, req, 'success_url');

        if (result.verified || result.alreadyVerified) {
            req.flash('success', res.__('flash_donation_done'));
        } else {
            req.flash('error', 'لم تكتمل عملية الدفع بنجاح.');
            return isGuestCheckout ? res.redirect('/cases') : res.redirect('/dashboard');
        }

        if (isGuestCheckout) {
            const caseId = session.metadata && session.metadata.caseId;
            return res.render('pages/donations/thank-you', {
                title: res.__('donation_thank_you_title'),
                caseId: caseId || null
            });
        }

        return res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء العودة من بوابة الدفع.');
        return req.user ? res.redirect('/dashboard') : res.redirect('/cases');
    }
};

exports.handleCheckoutCancel = async (req, res) => {
    try {
        const { transactionId } = req.query;
        if (transactionId) {
            await cleanupAbandonedStripeDonation({ metadata: { transactionId } });
        }

        req.flash('error', 'تم إلغاء عملية الدفع قبل الإتمام.');
        return res.redirect('/cases');
    } catch (err) {
        console.error(err);
        req.flash('error', 'حدث خطأ أثناء إلغاء عملية الدفع.');
        return res.redirect('/cases');
    }
};

exports.handleStripeWebhook = async (req, res) => {
    const stripe = getStripeClient();
    const webhookSecrets = collectWebhookSecrets();

    if (!stripe || webhookSecrets.length === 0) {
        systemLogger.error('Stripe webhook rejected: missing configuration');
        return res.status(503).send('Stripe webhook is not configured');
    }

    const signature = req.headers['stripe-signature'];
    if (!signature) {
        return res.status(400).send('Missing Stripe signature');
    }

    const rawBody = getStripeWebhookRawBody(req);
    if (!rawBody || rawBody.length === 0) {
        systemLogger.warn('Stripe webhook rejected: body is not raw', {
            bodyType: req.body === undefined ? 'undefined' : typeof req.body,
        });
        return res.status(400).send('Webhook requires raw JSON body');
    }

    let event;

    try {
        event = constructStripeWebhookEvent(stripe, rawBody, signature);
    } catch (err) {
        systemLogger.warn('Stripe webhook signature verification failed', {
            error: err.message,
            secretsTried: webhookSecrets.length,
            hint: getWebhookSignatureHint(webhookSecrets.length),
        });
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const logVerificationOutcome = (result, context) => {
        if (result.verified || result.alreadyVerified) return;
        systemLogger.warn('Stripe webhook event did not verify donation', {
            ...context,
            reason: result.reason || 'unknown'
        });
    };

    try {
        if (
            event.type === 'checkout.session.completed' ||
            event.type === 'checkout.session.async_payment_succeeded'
        ) {
            const result = await verifyDonationFromCheckoutSession(
                event.data.object,
                null,
                `webhook:${event.type}`
            );
            logVerificationOutcome(result, { eventType: event.type, sessionId: event.data.object.id });
            if (result.verified) {
                systemLogger.info('Webhook verified donation', {
                    eventType: event.type,
                    transactionId: result.transactionId
                });
            } else if (result.alreadyVerified) {
                systemLogger.info('Webhook donation already verified', {
                    eventType: event.type,
                    transactionId: result.transactionId
                });
            }
        }

        if (event.type === 'payment_intent.succeeded') {
            const paymentIntent = event.data.object;
            const meta = paymentIntent.metadata || {};

            if (meta.transactionId) {
                const result = await verifyDonationByTransactionId(meta.transactionId, {
                    paymentIntentId: paymentIntent.id,
                    source: 'webhook:payment_intent.succeeded'
                });
                logVerificationOutcome(result, { eventType: event.type, paymentIntentId: paymentIntent.id });
                if (result.verified || result.alreadyVerified) {
                    systemLogger.info('Webhook payment_intent verified donation', {
                        transactionId: result.transactionId,
                        legacy: true
                    });
                }
            } else if (
                meta.schemaVersion === '3' ||
                (meta.schemaVersion === '2' && meta.donorId)
            ) {
                const result = await createVerifiedDonationFromStripeMetadata(paymentIntent, {
                    paymentIntentId: paymentIntent.id,
                    source: 'webhook:payment_intent.succeeded'
                });
                logVerificationOutcome(result, { eventType: event.type, paymentIntentId: paymentIntent.id });
                if (result.verified || result.alreadyVerified) {
                    systemLogger.info('Webhook payment_intent verified donation', {
                        transactionId: result.transactionId
                    });
                }
            }
        }

        if (
            event.type === 'checkout.session.expired' ||
            event.type === 'checkout.session.async_payment_failed' ||
            event.type === 'payment_intent.payment_failed'
        ) {
            await cleanupAbandonedStripeDonation(event.data.object);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        systemLogger.error('Stripe webhook handling failed', { error: err.message, eventType: event.type });
        return res.status(500).json({ received: false });
    }
};

exports.getStripeWebhookStatus = (req, res) => {
    const stripe = getStripeClient();
    const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const secrets = collectWebhookSecrets();
    res.json({
        configured: Boolean(stripe && secrets.length > 0),
        stripeEnabled: Boolean(stripe),
        webhookSecretSet: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
        cliWebhookSecretSet: Boolean(process.env.STRIPE_CLI_WEBHOOK_SECRET),
        signingSecretsConfigured: secrets.length,
        endpoint: `${baseUrl}/donations/webhook`,
        metadataSchema: METADATA_SCHEMA_VERSION,
        localTestingNote:
            'stripe listen uses a different whsec_ than Dashboard — set STRIPE_CLI_WEBHOOK_SECRET from the CLI output.',
        events: [
            'checkout.session.completed',
            'checkout.session.async_payment_succeeded',
            'checkout.session.async_payment_failed',
            'checkout.session.expired',
            'payment_intent.succeeded',
            'payment_intent.payment_failed'
        ]
    });
};

if (getStripeClient() && collectWebhookSecrets().length === 0) {
    systemLogger.warn(
        'STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing — donations may not verify if the donor closes the browser before the success page'
    );
}

const User = require('../models/User');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { logActivity, systemLogger } = require('../utils/logger');
const sendEmail = require('../utils/emailSender');
const { welcomeEmail, passwordResetEmail } = require('../utils/emailTemplates');
const { validatePalestinianIban } = require('../utils/ibanValidator');
const { validatePalestinianId, normalizePalestinianId } = require('../utils/palestinianIdValidator');
const { PUBLIC_REGISTER_ROLES } = require('../utils/socketAuth');
const { parseJwtDuration } = require('../utils/jwtDuration');

const normalizeName = (name) => (name || '').trim().replace(/\s+/g, ' ').toLowerCase();

const namesMatch = (a, b) => normalizeName(a) === normalizeName(b);

const buildLoginQuery = (identifier) => {
    const value = (identifier || '').trim();
    if (!value) return null;

    if (value.includes('@')) {
        return { email: value.toLowerCase() };
    }

    return { idNumber: normalizePalestinianId(value) };
};

// Generate Token
const signToken = (id, expiresIn) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || '1d'
    });
};

const getTokenExpiry = (rememberMe) => {
    if (rememberMe) {
        return process.env.JWT_REMEMBER_EXPIRES_IN || '30d';
    }
    return process.env.JWT_EXPIRES_IN || '1d';
};

const getDashboardPathByRole = (role) => {
    if (role === 'admin' || role === 'super_admin' || role === 'regulator' || role === 'media') {
        return '/admin/dashboard';
    }

    if (role === 'support') {
        return '/support/admin/dashboard';
    }

    if (role === 'donor' || role === 'beneficiary' || role === 'family' || role === 'guardian') {
        return '/dashboard';
    }

    return '/dashboard';
};

const createSendToken = (user, statusCode, req, res, rememberMe = false) => {
    const expiresIn = getTokenExpiry(rememberMe);
    const token = signToken(user._id, expiresIn);
    const maxAge = parseJwtDuration(expiresIn);

    const cookieOptions = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    };

    if (rememberMe) {
        cookieOptions.maxAge = maxAge;
    }

    res.cookie('jwt', token, cookieOptions);

    user.password = undefined;

    const destination = user.mustChangePassword
        ? '/profile/force-password-change'
        : (['beneficiary', 'family', 'guardian'].includes(user.role) && user.status === 'pending')
            ? '/auth/pending'
            : getDashboardPathByRole(user.role);
    res.redirect(destination);
};

exports.getLogin = (req, res) => {
    res.render('pages/auth/login', { title: res.__('login') });
};

exports.getRegister = (req, res) => {
    res.render('pages/auth/register', { title: res.__('register_title') });
};

exports.getPending = (req, res) => {
    const beneficiaryRoles = ['beneficiary', 'family', 'guardian'];
    if (!beneficiaryRoles.includes(req.user.role)) {
        return res.redirect(getDashboardPathByRole(req.user.role));
    }
    if (req.user.status !== 'pending') {
        return res.redirect('/dashboard');
    }
    return res.render('pages/auth/pending-verification', { title: res.__('common_pending') });
};

exports.register = async (req, res) => {
    try {
        const { name, email, password, confirmPassword, role, phone, idNumber, address, altPhone, whatsapp, paymentDetails } = req.body;

        if (confirmPassword && password !== confirmPassword) {
            req.flash('error', res.__('flash_password_mismatch'));
            return res.redirect('/auth/register');
        }

        if (!PUBLIC_REGISTER_ROLES.includes(role)) {
            req.flash('error', res.__('flash_register_invalid_role'));
            return res.redirect('/auth/register');
        }

        let validatedBeneficiaryId;

        if (role === 'beneficiary') {
            const termsOk = req.body.beneficiaryTermsAccepted === 'accepted';
            if (!termsOk) {
                req.flash('error', res.__('flash_beneficiary_contract_required'));
                return res.redirect('/auth/register');
            }

            if (!idNumber || !address || !phone) {
                req.flash('error', res.__('flash_id_required'));
                return res.redirect('/auth/register');
            }

            const idValidation = validatePalestinianId(idNumber);
            if (!idValidation.valid) {
                req.flash('error', res.__(idValidation.errorKey));
                return res.redirect('/auth/register');
            }

            validatedBeneficiaryId = idValidation.idNumber;

            if (phone.length !== 10) {
                req.flash('error', res.__('register_phone_length_error'));
                return res.redirect('/auth/register');
            }
            if (altPhone && altPhone.length !== 10) {
                req.flash('error', res.__('register_phone_length_error'));
                return res.redirect('/auth/register');
            }

            const ibanValidation = validatePalestinianIban(paymentDetails && paymentDetails.iban);
            if (!ibanValidation.valid) {
                req.flash('error', res.__(ibanValidation.errorKey));
                return res.redirect('/auth/register');
            }

            const iban = ibanValidation.iban;
            const accountHolder = (paymentDetails && paymentDetails.accountHolder || '').trim();

            if (!accountHolder) {
                req.flash('error', res.__('register_account_holder_required'));
                return res.redirect('/auth/register');
            }

            if (!namesMatch(accountHolder, name)) {
                req.flash('error', res.__('register_account_holder_mismatch'));
                return res.redirect('/auth/register');
            }

            const existingIban = await User.findOne({ 'paymentDetails.iban': iban });
            if (existingIban) {
                req.flash('error', res.__('flash_iban_taken'));
                return res.redirect('/auth/register');
            }

            paymentDetails.iban = iban;
            paymentDetails.accountHolder = accountHolder;
            delete paymentDetails.palpayNumber;
            delete paymentDetails.jawwalPayNumber;
        } else if (role === 'donor') {
            // For donors, phone is not required, only optional whatsapp
            if (whatsapp && whatsapp.length !== 10) {
                req.flash('error', res.__('register_phone_length_error'));
                return res.redirect('/auth/register');
            }
        }

        const normalizedEmail = (email || '').trim().toLowerCase();

        const newUser = await User.create({
            name,
            email: normalizedEmail,
            password,
            role,
            phone: role === 'beneficiary' ? phone : undefined,
            altPhone: role === 'beneficiary' ? altPhone : undefined,
            whatsapp: role === 'donor' ? whatsapp : undefined,
            idNumber: validatedBeneficiaryId,
            address,
            paymentDetails: role === 'beneficiary' ? paymentDetails : undefined,
            beneficiaryTermsAcceptedAt: role === 'beneficiary' ? new Date() : undefined,
            status: role === 'donor' ? 'active' : 'pending',
            activatedAt: role === 'donor' ? new Date() : undefined
        });

        try {
            const emailResult = await sendEmail({
                email: newUser.email,
                subject: res.__('email_welcome_subject'),
                html: welcomeEmail(newUser.name),
                type: 'welcome',
                immediate: true
            });
            if (!emailResult.ok) {
                systemLogger.warn('Welcome email not delivered', {
                    userId: String(newUser._id),
                    reason: emailResult.reason
                });
            }
        } catch (emailErr) {
            systemLogger.error('Failed to send welcome email', { error: emailErr.message });
        }

        createSendToken(newUser, 201, req, res);
    } catch (err) {
        console.error(err);
        if (err.code === 11000) {
            if (err.keyPattern && err.keyPattern.idNumber) {
                req.flash('error', res.__('flash_id_registered'));
            } else if (err.keyPattern && err.keyPattern['paymentDetails.iban']) {
                req.flash('error', res.__('flash_iban_taken'));
            } else {
                req.flash('error', res.__('flash_email_taken'));
            }
        } else {
            req.flash('error', res.__('flash_register_error'));
        }
        res.redirect('/auth/register');
    }
};

exports.login = async (req, res) => {
    try {
        const DISABLE_LOGIN = process.env.DISABLE_LOGIN === 'true';
        if (DISABLE_LOGIN) {
            req.flash('error', res.__('flash_login_disabled_maintenance'));
            return res.redirect('/auth/login');
        }

        const identifier = (req.body.identifier || req.body.email || '').trim();
        const { password } = req.body;
        const rememberMe = req.body.rememberMe === 'on' || req.body.rememberMe === 'true';

        if (!identifier || !password) {
            req.flash('error', res.__('flash_login_missing'));
            return res.redirect('/auth/login');
        }

        const loginQuery = buildLoginQuery(identifier);
        const user = await User.findOne(loginQuery).select('+password');

        if (!user || !(await user.comparePassword(password))) {
            req.flash('error', res.__('flash_login_invalid'));
            return res.redirect('/auth/login');
        }

        if (user.isSoftDeleted) {
            req.flash('error', res.__('flash_account_suspended', { reason: user.softDeleteReason || res.__('common_tos_violation') }));
            return res.redirect('/auth/login');
        }

        // Log the login
        await logActivity(user._id, 'login', 'User', user._id, res.__('log_user_login', { email: user.email }));

        createSendToken(user, 200, req, res, rememberMe);
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_login_error'));
        res.redirect('/auth/login');
    }
};

exports.logout = async (req, res) => {
    if (req.user) {
        await logActivity(req.user._id, 'logout', 'User', req.user._id, res.__('log_user_logout'));
    }
    res.cookie('jwt', 'loggedout', {
        expires: new Date(Date.now() + 10 * 1000),
        httpOnly: true
    });
    res.redirect('/');
};

exports.getForgotPassword = (req, res) => {
    res.render('pages/auth/forgot-password', { title: res.__('forgot_password_title') });
};

exports.forgotPassword = async (req, res) => {
    try {
        const email = (req.body.email || '').trim().toLowerCase();
        if (!email) {
            req.flash('error', res.__('flash_forgot_password_email_required'));
            return res.redirect('/auth/forgot-password');
        }

        const user = await User.findByEmail(email);

        if (user && !user.isSoftDeleted) {
            const resetToken = user.createPasswordResetToken();
            await user.save({ validateBeforeSave: false });

            const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
            const resetURL = `${baseUrl}/auth/reset-password/${resetToken}`;

            const emailResult = await sendEmail({
                email: user.email,
                subject: res.__('email_reset_password_subject'),
                html: passwordResetEmail(user.name, resetURL),
                type: 'password_reset',
                immediate: true
            });
            if (!emailResult.ok) {
                systemLogger.error('Password reset email not delivered', {
                    userId: String(user._id),
                    reason: emailResult.reason,
                    error: emailResult.error && emailResult.error.message
                });
            } else {
                systemLogger.info('Password reset email dispatched', {
                    userId: String(user._id),
                    delivery: emailResult.delivery
                });
            }
        } else {
            systemLogger.info('Password reset requested for unknown email', { email });
        }

        req.flash('success', res.__('flash_forgot_password_sent'));
        res.redirect('/auth/login');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_forgot_password_error'));
        res.redirect('/auth/forgot-password');
    }
};

exports.getResetPassword = async (req, res) => {
    try {
        const hashedToken = crypto
            .createHash('sha256')
            .update(req.params.token)
            .digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() }
        });

        if (!user) {
            req.flash('error', res.__('flash_reset_password_invalid'));
            return res.redirect('/auth/forgot-password');
        }

        res.render('pages/auth/reset-password', {
            title: res.__('reset_password_title'),
            token: req.params.token
        });
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_reset_password_error'));
        res.redirect('/auth/forgot-password');
    }
};

exports.resetPassword = async (req, res) => {
    try {
        const { password, confirmPassword } = req.body;

        if (!password || !confirmPassword) {
            req.flash('error', res.__('flash_login_missing'));
            return res.redirect(`/auth/reset-password/${req.params.token}`);
        }

        if (password !== confirmPassword) {
            req.flash('error', res.__('flash_password_mismatch'));
            return res.redirect(`/auth/reset-password/${req.params.token}`);
        }

        const hashedToken = crypto
            .createHash('sha256')
            .update(req.params.token)
            .digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpires: { $gt: Date.now() }
        }).select('+passwordResetToken +passwordResetExpires');

        if (!user) {
            req.flash('error', res.__('flash_reset_password_invalid'));
            return res.redirect('/auth/forgot-password');
        }

        user.password = password;
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();

        await logActivity(user._id, 'profile_update', 'User', user._id, 'تم إعادة تعيين كلمة المرور عبر البريد الإلكتروني');

        req.flash('success', res.__('flash_reset_password_success'));
        res.redirect('/auth/login');
    } catch (err) {
        console.error(err);
        req.flash('error', res.__('flash_reset_password_error'));
        res.redirect(`/auth/reset-password/${req.params.token}`);
    }
};

// Phase 10: Advanced AJAX Validation
exports.checkExists = async (req, res) => {
    try {
        const { field, value } = req.query;
        if (!['email', 'phone', 'idNumber', 'iban'].includes(field)) {
            return res.status(400).json({ exists: false });
        }

        if (field === 'idNumber') {
            const idValidation = validatePalestinianId(value);
            if (!idValidation.valid) {
                return res.json({
                    exists: false,
                    invalid: true,
                    message: res.__(idValidation.errorKey)
                });
            }

            const user = await User.findOne({ idNumber: idValidation.idNumber });
            return res.json({ exists: !!user, invalid: false });
        }

        if (field === 'iban') {
            const ibanValidation = validatePalestinianIban(value);
            if (!ibanValidation.valid) {
                return res.json({
                    exists: false,
                    invalid: true,
                    message: res.__(ibanValidation.errorKey)
                });
            }

            const user = await User.findOne({ 'paymentDetails.iban': ibanValidation.iban });
            return res.json({ exists: !!user, invalid: false });
        }

        const query = { [field]: value };
        const user = await User.findOne(query);

        res.json({ exists: !!user, invalid: false });
    } catch (err) {
        res.status(500).json({ exists: false });
    }
};

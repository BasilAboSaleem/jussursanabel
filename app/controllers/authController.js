const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { logActivity } = require('../utils/logger');
const sendEmail = require('../utils/emailSender');
const { welcomeEmail } = require('../utils/emailTemplates');

// Generate Token
const signToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN
    });
};

const createSendToken = (user, statusCode, req, res) => {
    const token = signToken(user._id);

    res.cookie('jwt', token, {
        expires: new Date(Date.now() + parseInt(process.env.JWT_EXPIRES_IN.slice(0, -1)) * 24 * 60 * 60 * 1000),
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    });

    // Remove password from output
    user.password = undefined;

    // Role-specific redirection (Phase 4 Improvement)
    if (user.role === 'beneficiary' || user.role === 'family' || user.role === 'guardian') {
        res.redirect('/cases/register');
    } else if (user.role === 'donor') {
        res.redirect('/cases');
    } else {
        res.redirect('/');
    }
};

exports.getLogin = (req, res) => {
    res.render('pages/auth/login', { title: res.__('login') });
};

exports.getRegister = (req, res) => {
    res.render('pages/auth/register', { title: res.__('register_title') });
};

exports.register = async (req, res) => {
    try {
        const { name, email, password, confirmPassword, role, phone, idNumber, address, altPhone, whatsapp, paymentDetails } = req.body;

        if (confirmPassword && password !== confirmPassword) {
            req.flash('error', res.__('flash_password_mismatch'));
            return res.redirect('/auth/register');
        }

        if (role === 'beneficiary') {
            if (!idNumber || !address || !phone) {
                req.flash('error', res.__('flash_id_required'));
                return res.redirect('/auth/register');
            }

            // Strict length validation
            if (idNumber.length !== 9) {
                req.flash('error', res.__('register_id_length_error'));
                return res.redirect('/auth/register');
            }
            if (phone.length !== 10) {
                req.flash('error', res.__('register_phone_length_error'));
                return res.redirect('/auth/register');
            }
            if (altPhone && altPhone.length !== 10) {
                req.flash('error', res.__('register_phone_length_error'));
                return res.redirect('/auth/register');
            }

            // Financial validation: at least one method required
            if (!paymentDetails || (!paymentDetails.iban && !paymentDetails.palpayNumber && !paymentDetails.jawwalPayNumber)) {
                req.flash('error', res.__('register_financial_one_required'));
                return res.redirect('/auth/register');
            }
        } else if (role === 'donor') {
            // For donors, phone is not required, only optional whatsapp
            if (whatsapp && whatsapp.length !== 10) {
                req.flash('error', res.__('register_phone_length_error'));
                return res.redirect('/auth/register');
            }
        }

        const newUser = await User.create({
            name,
            email,
            password,
            role,
            phone: role === 'beneficiary' ? phone : undefined,
            altPhone: role === 'beneficiary' ? altPhone : undefined,
            whatsapp: role === 'donor' ? whatsapp : undefined,
            idNumber: role === 'beneficiary' ? idNumber : undefined,
            address,
            paymentDetails: role === 'beneficiary' ? paymentDetails : undefined,
            status: (role === 'donor' || role === 'admin' || role === 'super_admin') ? 'active' : 'pending'
        });

        // Send Welcome Email
        try {
            await sendEmail({
                email: newUser.email,
                subject: res.__('email_welcome_subject'),
                html: welcomeEmail(newUser.name)
            });
        } catch (emailErr) {
            console.error('Failed to send welcome email:', emailErr);
        }

        createSendToken(newUser, 201, req, res);
    } catch (err) {
        console.error(err);
        if (err.code === 11000) {
            if (err.keyPattern && err.keyPattern.idNumber) {
                req.flash('error', res.__('flash_id_registered'));
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

        const { email, password } = req.body;

        if (!email || !password) {
            req.flash('error', res.__('flash_login_missing'));
            return res.redirect('/auth/login');
        }

        const user = await User.findOne({ email }).select('+password');

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

        createSendToken(user, 200, req, res);
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

// Phase 10: Advanced AJAX Validation
exports.checkExists = async (req, res) => {
    try {
        const { field, value } = req.query;
        if (!['email', 'phone', 'idNumber'].includes(field)) {
            return res.status(400).json({ exists: false });
        }

        const query = { [field]: value };
        const user = await User.findOne(query);
        
        res.json({ exists: !!user });
    } catch (err) {
        res.status(500).json({ exists: false });
    }
};

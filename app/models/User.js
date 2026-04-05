const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { 
        type: String, 
        enum: ['donor', 'beneficiary', 'family', 'guardian', 'admin', 'super_admin', 'regulator', 'support'], 
        default: 'donor' 
    },
    phone: { type: String },
    altPhone: { type: String },
    whatsapp: { type: String },
    avatar: { type: String, default: '/assets/images/default-avatar.png' },
    idNumber: { type: String, unique: true, sparse: true },
    address: { type: String },
    status: { type: String, enum: ['active', 'pending', 'suspended'], default: 'active' },
    blockedUsers: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        reason: String,
        at: { type: Date, default: Date.now }
    }],
    globalCommBan: { type: Boolean, default: false },
    globalCommBanReason: { type: String },
    isSoftDeleted: { type: Boolean, default: false },
    softDeleteReason: { type: String },
    moderationNotes: [{
        admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        note: String,
        type: { 
            type: String, 
            enum: ['note', 'warning', 'ban', 'ban_user_specific', 'ban_global_comm', 'soft_delete', 'hard_delete', 'undo_warning', 'undo_ban_user_specific', 'undo_ban_global_comm', 'undo_soft_delete'] 
        },
        createdAt: { type: Date, default: Date.now }
    }],
    warningsCount: { type: Number, default: 0 },
    chatWindow: {
        from: { type: String, default: '' }, // e.g. "10:00"
        to:   { type: String, default: '' }  // e.g. "16:00"
    },
    paymentDetails: {
        bankName: { type: String },
        bankBranch: { type: String },
        accountHolder: { type: String },
        accountNumber: { type: String },
        iban: { type: String },
        palpayNumber: { type: String },
        jawwalPayNumber: { type: String },
        otherMethod: { type: String }
    },
    createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
userSchema.pre('save', async function() {
    // Phase 8: Admin Branding Lockdown
    if (this.role === 'admin' || this.role === 'super_admin') {
        const adminName = this.role === 'super_admin' ? 'Super Admin' : 'Admin';
        this.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(adminName)}&background=020617&color=D4AF37&bold=true&size=512`;
    }

    if (!this.isModified('password')) return;
    this.password = await bcrypt.hash(this.password, 12);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);

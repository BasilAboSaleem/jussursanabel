const mongoose = require('mongoose');

const adminRequestSchema = new mongoose.Schema({
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
        type: String, 
        enum: ['hard_delete_user', 'change_role', 'other'], 
        required: true 
    },
    targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    targetCase: { type: mongoose.Schema.Types.ObjectId, ref: 'Case' },
    reason: { type: String, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected'], 
        default: 'pending' 
    },
    superAdminReply: { type: String },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AdminRequest', adminRequestSchema);

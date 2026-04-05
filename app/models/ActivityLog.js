const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { 
        type: String, 
        required: true,
        enum: [
            'login', 'logout', 'profile_update', 
            'case_create', 'case_update', 'case_delete', 
            'transaction_create', 'transaction_verify', 
            'user_moderate', 'user_activate', 'user_create', 'user_delete', 'user_hard_delete', 
            'settings_update', 'chat_request_handle', 'chat_request_create',
            'impact_proof_approve', 'impact_proof_reject',
            'admin_escalation_request', 'admin_escalation_approved', 'admin_escalation_rejected',
            'bank_confirmation', 'payout_generate'
        ]
    },
    targetType: { type: String, enum: ['User', 'Case', 'Transaction', 'ChatRequest', 'Settings', 'AdminRequest', 'CaseUpdate', 'BankReceipt', 'Payout'] },
    targetId: { type: mongoose.Schema.Types.ObjectId },
    details: { type: String }, // Human readable description
    metadata: { type: Object }, // Raw data before/after if needed
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);

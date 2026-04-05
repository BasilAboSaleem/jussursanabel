const mongoose = require('mongoose');

const caseUpdateSchema = new mongoose.Schema({
    case: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true },
    guardian: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    content: { type: String, required: true },
    images: [String], // URL to photos/invoices
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected'], 
        default: 'pending' 
    },
    rejectionReason: { type: String },
    adminNotes: { type: String },
    createdAt: { type: Date, default: Date.now },
    approvedAt: { type: Date }
});

module.exports = mongoose.model('CaseUpdate', caseUpdateSchema);

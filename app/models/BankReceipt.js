const mongoose = require('mongoose');

const bankReceiptSchema = new mongoose.Schema({
    reference: { type: String, required: true, unique: true }, // e.g. BR-2026-0001
    expectedDonations: { type: Number, required: true },
    expectedOperationalFees: { type: Number, required: true },
    expectedTotal: { type: Number, required: true }, // donations + fees
    actualReceived: { type: Number, required: true }, // User inputs this
    variance: { type: Number, default: 0 }, // expectedTotal - actualReceived
    shortfallAction: { 
        type: String, 
        enum: ['none', 'deduct_from_fees', 'deduct_from_cases'], 
        default: 'none' 
    },
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
    bankStatementProof: { type: String }, // URL to bank statement scan/image
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('BankReceipt', bankReceiptSchema);

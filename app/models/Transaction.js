const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    donor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    case: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team' }, // Optional: link to a fundraising team
    amount: { type: Number, required: true }, // The original donation amount for the case
    institutionPercentage: { type: Number, default: 0 },
    gatewayPercentage: { type: Number, default: 0 },
    operationPercentage: { type: Number, default: 0 }, // Sum of both
    institutionFee: { type: Number, default: 0 },
    gatewayFee: { type: Number, default: 0 },
    operationFee: { type: Number, default: 0 }, // Sum of both
    totalAmount: { type: Number, required: true }, // amount + operationFee
    netDonationAmount: { type: Number }, // The actual final amount assigned to case after any bank shortfalls
    type: { type: String, enum: ['direct', 'monthly'], required: true },
    paymentMethod: { type: String, default: 'receipt_upload' }, // For P2P
    receiptImage: { type: String }, 
    status: { 
        type: String, 
        enum: ['pending', 'verified', 'failed'], 
        default: 'pending' 
    },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: { type: Date },
    isAnonymous: { type: Boolean, default: false },
    encouragementMessage: { type: String },
    isBankConfirmed: { type: Boolean, default: false },
    bankReceipt: { type: mongoose.Schema.Types.ObjectId, ref: 'BankReceipt' },
    disbursementStatus: { 
        type: String, 
        enum: ['pending', 'disbursed'], 
        default: 'pending' 
    },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', transactionSchema);

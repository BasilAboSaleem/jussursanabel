const mongoose = require('mongoose');

const payoutSchema = new mongoose.Schema({
    case: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true },
    amount: { type: Number, required: true },
    payoutNumber: { type: String, unique: true, required: true },
    paymentMethod: { type: String, required: true },
    transactions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
    payoutDate: { type: Date, default: Date.now },
    status: { 
        type: String, 
        enum: ['pending', 'completed'], 
        default: 'completed' 
    },
    receiptImage: { type: String }, // Digital voucher PNG path
    notes: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Payout', payoutSchema);

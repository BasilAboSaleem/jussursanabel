const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    case: { type: mongoose.Schema.Types.ObjectId, ref: 'Case' }, // Context of the conversation
    chatRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRequest' }, // Link to approved request
    supportTicket: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket' }, // Link to support ticket
    content: { type: String },
    imageUrl: { type: String },
    isRead: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'flagged', 'archived'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);

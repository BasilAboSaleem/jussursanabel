const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema({
    name: { type: String, required: true },
    creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    case: { type: mongoose.Schema.Types.ObjectId, ref: 'Case', required: true },
    description: { type: String },
    totalRaised: { type: Number, default: 0 },
    donorCount: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Team', teamSchema);

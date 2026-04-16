const mongoose = require('mongoose');

const caseSchema = new mongoose.Schema({
    title: { type: String, required: true },
    type: { type: String, enum: ['orphan', 'family'], required: true },
    description: { type: String, required: true },
    image: { type: String }, // Main photo/thumbnail
    gallery: [String], // Verification photos/documents
    storyVideo: { type: String }, // Optional Short/Reel video for urgent cases and full screen viewing
    targetAmount: { type: Number }, // For direct donates
    raisedAmount: { type: Number, default: 0 },
    monthlySponsorshipAmount: { type: Number, default: 100 }, // suggested amount
    status: { 
        type: String, 
        enum: ['pending', 'field_verification', 'approved', 'rejected', 'fully_sponsored'], 
        default: 'pending' 
    },
    verificationNotes: { type: String },
    rejectionReason: { type: String },
    location: { type: String },
    guardian: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to family/guardian user
    details: {
        familyCount: { type: Number },
        orphanCount: { type: Number },
        storyAr: { type: String }, // Emotional story in Arabic
    },
    familyStructure: {
        isFatherDeceased: { type: Boolean },
        mother: {
            isDeceased: { type: Boolean },
            deathDate: { type: Date },
            deathReason: { type: String },
            name: { type: String },
            healthStatus: { type: String, enum: ['healthy', 'sick', 'disabled', 'war_injury'] },
            age: { type: Number }
        },
        father: {
            name: { type: String },
            deathDate: { type: Date },
            deathReason: { type: String }
        },
        guardian: {
            name: { type: String },
            healthStatus: { type: String, enum: ['healthy', 'sick', 'disabled', 'war_injury'] },
            birthDate: { type: Date },
            idNumber: { type: String },
            phone: { type: String },
            familySize: { type: Number },
            housingStatus: { type: String, enum: ['tent', 'rent', 'damaged_home', 'host_family'] },
            residencyStatus: { type: String, enum: ['resident', 'displaced'] }
        },
        orphans: [{
            name: { type: String },
            birthDate: { type: Date },
            age: { type: Number },
            healthStatus: { type: String, enum: ['healthy', 'sick', 'disabled', 'war_injury'] },
            educationStage: { type: String, enum: ['kindergarten', 'primary', 'preparatory', 'secondary'] }
        }]
    },
    isFieldVerified: { type: Boolean, default: false },
    housingStatus: { 
        type: String, 
        enum: ['tent', 'rental', 'host_family', 'destroyed_home', 'other'],
        default: 'other' 
    },
    area: { type: String },
    updates: [{
        title: String,
        content: String,
        images: [String],
        postedBy: { type: String, enum: ['admin', 'family'], default: 'admin' },
        createdAt: { type: Date, default: Date.now }
    }],
    sponsorshipExpiryDate: { type: Date },
    currentSponsor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isSatisfied: { type: Boolean, default: false },
    satisfiedBy: { type: String, enum: ['admin', 'guardian', 'none'], default: 'none' },
    needs: [{ type: String }],
    // Phase 2: Trust & Impact
    impactMetrics: [{
        amount: { type: Number, required: true },
        descriptionAr: { type: String, required: true }
    }],
    followers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    isHidden: { type: Boolean, default: false },
    isStoryHidden: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    referenceNumber: { type: String, unique: true, sparse: true }
});

caseSchema.index({ status: 1, isHidden: 1, createdAt: -1 });
caseSchema.index({ status: 1, isHidden: 1, type: 1, createdAt: -1 });
caseSchema.index({ status: 1, isHidden: 1, isStoryHidden: 1, createdAt: -1 });
caseSchema.index({ guardian: 1, status: 1, isSatisfied: 1 });
caseSchema.index({ currentSponsor: 1, sponsorshipExpiryDate: 1 });

// Pre-save hook to generate intuitive and short referenceNumber
caseSchema.pre('save', async function() {
    if (!this.referenceNumber) {
        const randomStr = Math.random().toString(36).substring(2, 7).toUpperCase();
        this.referenceNumber = `JSR-${randomStr}`;
    }
});

module.exports = mongoose.model('Case', caseSchema);

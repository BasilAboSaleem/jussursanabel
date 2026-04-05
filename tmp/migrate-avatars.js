const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const User = require('./app/models/User');

async function migrate() {
    try {
        console.log('Starting migration...');
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sanabel';
        await mongoose.connect(uri);
        console.log('Connected to DB');

        const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } });
        console.log(`Found ${admins.length} admins.`);

        for (const admin of admins) {
            const adminName = admin.role === 'super_admin' ? 'Super Admin' : 'Admin';
            admin.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(adminName)}&background=020617&color=D4AF37&bold=true&size=512`;
            // Trigger pre-save hook just in case, although setting it manually here is fine
            await admin.save();
            console.log(`Updated: ${admin.name} -> ${admin.avatar}`);
        }

        console.log('Migration finished successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration error:', err);
        process.exit(1);
    }
}

migrate();

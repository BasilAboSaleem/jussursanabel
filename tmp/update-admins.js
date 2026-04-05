const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./app/models/User');

async function updateAdmins() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/sanabel');
        console.log('Connected to MongoDB');

        const admins = await User.find({ role: { $in: ['admin', 'super_admin'] } });
        console.log(`Found ${admins.length} admins to update.`);

        for (const admin of admins) {
            const adminName = admin.role === 'super_admin' ? 'Super Admin' : 'Admin';
            admin.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(adminName)}&background=020617&color=D4AF37&bold=true&size=512`;
            await admin.save();
            console.log(`Updated avatar for: ${admin.name} (${admin.email})`);
        }

        console.log('All admins updated successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

updateAdmins();

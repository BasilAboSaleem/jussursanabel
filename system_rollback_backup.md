# Rollback Instructions

If you need to revert all changes made to the database connection and system stability, use the following original contents for each file.

## 1. app/constants/db.js

```javascript
const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    console.log("⏳ Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ MongoDB connected successfully");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  }
};

module.exports = connectDB;
```

## 2. seed.js

```javascript
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./app/models/User');

const seedAdmins = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // Check if super admin already exists
        const existingSuper = await User.findOne({ email: 'superadmin@sanabel.ps' });
        if (!existingSuper) {
            await User.create({
                name: 'Super Admin',
                email: 'superadmin@sanabel.ps',
                password: 'password123',
                role: 'super_admin'
            });
            console.log('Super Admin created: superadmin@sanabel.ps / password123');
        } else {
            existingSuper.password = 'password123';
            await existingSuper.save();
            console.log('Super Admin password reset: superadmin@sanabel.ps / password123');
        }

        // Check if admin already exists
        const existingAdmin = await User.findOne({ email: 'admin@sanabel.ps' });
        if (!existingAdmin) {
            await User.create({
                name: 'Admin User',
                email: 'admin@sanabel.ps',
                password: 'password123',
                role: 'admin'
            });
            console.log('Admin created: admin@sanabel.ps / password123');
        } else {
            existingAdmin.password = 'password123';
            await existingAdmin.save();
            console.log('Admin password reset: admin@sanabel.ps / password123');
        }

        await mongoose.disconnect();
        console.log('Seeding complete');
    } catch (err) {
        console.error('Seeding error:', err);
        process.exit(1);
    }
};

seedAdmins();
```

## 3. seed-family.js

```javascript
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const User = require('./app/models/User');
require('dotenv').config();

async function createFamilyUser() {
    await mongoose.connect(process.env.MONGODB_URI);
    const hashedPassword = await bcrypt.hash('test1234', 12);
    const user = await User.create({
        name: 'عائلة تجريبية',
        email: 'family@test.com',
        password: 'test1234',
        role: 'family',
        phone: '0500000000'
    });
    console.log('Family user created:', user.email);
    process.exit();
}

createFamilyUser();
```

## 4. package.json

(Note: Restoration should only exclude the `nodemonConfig` field if added)

```json
{
  "name": "jussur-sanabel",
  "version": "1.0.0",
  "description": "",
  "main": "app.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "commonjs",
  "dependencies": {
    "axios": "^1.13.6",
    "bcrypt": "^6.0.0",
    "cloudinary": "^1.41.0",
    "compression": "^1.8.1",
    "connect-flash": "^0.1.1",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.6",
    "csurf": "^1.11.0",
    "dotenv": "^17.3.1",
    "ejs": "^5.0.1",
    "express": "^5.2.1",
    "express-rate-limit": "^8.3.1",
    "express-session": "^1.19.0",
    "express-validator": "^7.3.1",
    "helmet": "^8.1.0",
    "i18n": "^0.15.3",
    "jsonwebtoken": "^90.3",
    "method-override": "^3.0.0",
    "mongoose": "^9.2.4",
    "morgan": "^1.10.1",
    "multer": "^1.4.5-lts.1",
    "nodemailer": "^8.0.3",
    "socket.io": "^4.8.3",
    "winston": "^3.19.0",
    "winston-daily-rotate-file": "^5.0.0"
  },
  "devDependencies": {
    "@capacitor/android": "^6.1.2",
    "@capacitor/cli": "^6.1.2",
    "@capacitor/core": "^6.1.2",
    "@capacitor/ios": "^6.1.2",
    "nodemon": "^3.1.14"
  }
}
```

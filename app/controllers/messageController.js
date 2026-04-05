const Message = require('../models/Message');
const User = require('../models/User');
const ChatRequest = require('../models/ChatRequest');
const Case = require('../models/Case');
const Notification = require('../models/Notification');
const cloudinary = require('../utils/cloudinary');
const fs = require('fs');

const getUserId = (b) => {
    if (!b) return null;
    const val = (b && b.user) ? b.user : b;
    if (!val) return null;
    const id = (val._id || val).toString().trim();
    return id;
};

const isCommunicationBlocked = (user1, user2) => {
    if (!user1 || !user2) return { blocked: false };
    
    const id1 = user1._id.toString().trim();
    const id2 = user2._id.toString().trim();

    // Check user1's blocks
    if (user1.blockedUsers && Array.isArray(user1.blockedUsers)) {
        for (const b of user1.blockedUsers) {
            if (getUserId(b) === id2) return { blocked: true, by: 'sender', reason: b.reason || b.note };
        }
    }

    // Check user2's blocks (Mutual Enforcement)
    if (user2.blockedUsers && Array.isArray(user2.blockedUsers)) {
        for (const b of user2.blockedUsers) {
            if (getUserId(b) === id1) return { blocked: true, by: 'receiver', reason: b.reason || b.note };
        }
    }

    return { blocked: false };
};

const formatUserForChat = (user, res) => {
    if (!user) return null;
    const userObj = typeof user.toObject === 'function' ? user.toObject() : { ...user };
    if (userObj.role === 'admin' || userObj.role === 'super_admin' || userObj.role === 'support' || userObj.role === 'regulator') {
        userObj.name = res.__('support_team_name');
        userObj.isSupport = true;
    }
    return userObj;
};

exports.getMessages = async (req, res) => {
    try {
        const userId = req.user._id;
        
        // Get all unique users this user has chatted with
        const messages = await Message.find({
            $or: [{ sender: userId }, { receiver: userId }]
        }).populate('sender receiver').sort({ createdAt: -1 });

        const contactsMap = new Map();
        
        // 1. Add approved chat requests as potential contacts
        const approvedRequests = await ChatRequest.find({
            $or: [{ donor: userId }, { family: userId }],
            status: 'approved'
        }).populate('donor family');

        approvedRequests.forEach(req => {
            if (!req.donor || !req.family) return;
            const otherUser = req.donor._id.equals(userId) ? req.family : req.donor;
            if (otherUser && !contactsMap.has(otherUser._id.toString())) {
                contactsMap.set(otherUser._id.toString(), {
                    user: otherUser,
                    lastMessage: res.__('msg_start_chat'),
                    time: req.createdAt
                });
            }
        });

        // 2. Overlay with actual message history
        messages.forEach(msg => {
            if (!msg.sender || !msg.receiver) return; // Skip if user was deleted
            let otherUser = msg.sender._id.equals(userId) ? msg.receiver : msg.sender;
            otherUser = formatUserForChat(otherUser, res);

            if (otherUser) {
                contactsMap.set(otherUser._id.toString(), {
                    user: otherUser,
                    lastMessage: msg.content,
                    time: msg.createdAt
                });
            }
        });

        const contacts = Array.from(contactsMap.values()).sort((a, b) => b.time - a.time);

        res.render('pages/messages/index', { 
            title: res.__('navbar_messages'),
            contacts,
            activeContact: null,
            chatHistory: []
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getChatHistory = async (req, res) => {
    try {
        const userId = req.user._id;
        const otherUserId = req.params.userId;

        const chatHistory = await Message.find({
            $or: [
                { sender: userId, receiver: otherUserId },
                { sender: otherUserId, receiver: userId }
            ]
        }).sort({ createdAt: 1 });

        const otherUser = formatUserForChat(await User.findById(otherUserId), res);
        if (!otherUser) {
            req.flash('error', res.__('flash_user_not_found'));
            return res.redirect('/messages');
        }
        
        // Mark as read
        await Message.updateMany(
            { sender: otherUserId, receiver: userId, isRead: false },
            { isRead: true }
        );

        const contactsMap = new Map();

        // 1. Add approved chat requests
        const approvedRequests = await ChatRequest.find({
            $or: [{ donor: userId }, { family: userId }],
            status: 'approved'
        }).populate('donor family');

        approvedRequests.forEach(req => {
            if (!req.donor || !req.family) return;
            const otherUser = req.donor._id.equals(userId) ? req.family : req.donor;
            if (otherUser && !contactsMap.has(otherUser._id.toString())) {
                contactsMap.set(otherUser._id.toString(), {
                    user: otherUser,
                    lastMessage: res.__('msg_start_chat'),
                    time: req.createdAt
                });
            }
        });

        // 2. Overlay with actual message history
        const allMessages = await Message.find({
            $or: [{ sender: userId }, { receiver: userId }]
        }).populate('sender receiver').sort({ createdAt: -1 });

        allMessages.forEach(msg => {
            if (!msg.sender || !msg.receiver) return; // Skip if user was deleted
            let contact = msg.sender._id.equals(userId) ? msg.receiver : msg.sender;
            contact = formatUserForChat(contact, res);

            if (contact) {
                contactsMap.set(contact._id.toString(), {
                    user: contact,
                    lastMessage: msg.content,
                    time: msg.createdAt
                });
            }
        });

        // 3. Find the chat request and its consent status
        const chatRequest = await ChatRequest.findOne({
            $or: [
                { donor: userId, family: otherUserId },
                { donor: otherUserId, family: userId }
            ],
            status: 'approved'
        });

        // 4. Check for Bans & Reasons
        let isBlocked = false;
        let blockReason = '';
        const isSupport = otherUser.role === 'admin' || otherUser.role === 'super_admin';

        if (req.user.globalCommBan && !isSupport) {
            isBlocked = true;
            blockReason = req.user.globalCommBanReason || res.__('error_account_banned_global');
        } else if (otherUser.globalCommBan && !req.user.role?.includes('admin')) {
            isBlocked = true;
            blockReason = res.__('error_user_banned_global');
        } else {
            const blockCheck = isCommunicationBlocked(req.user, otherUser);
            
            console.log(`[NUCLEAR-DEBUG] getChatHistory for ${req.user.name} and ${otherUser.name}:`);
            console.log(` - Result: ${blockCheck.blocked ? 'BLOCKED' : 'ALLOWED'}`);
            if (blockCheck.blocked) console.log(` - Details: By ${blockCheck.by}, Reason: ${blockCheck.reason}`);

            if (blockCheck.blocked) {
                isBlocked = true;
                blockReason = blockCheck.reason || res.__('error_comm_blocked_admin');
            }
        }


        // === Chat Day / Window Enforcement ===
        let isChatRestricted = false;
        let restrictionReason = '';
        let chatDayName = '';
        let donorWindow = null;
        
        if (!isSupport && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
            const { getChatDay, isChatAllowed, DAY_NAMES_AR } = require('../utils/chatUtils');
            const chatDay = await getChatDay();
            chatDayName = DAY_NAMES_AR[chatDay];
            const donorUser = req.user.role === 'donor' ? req.user : (otherUser.role === 'donor' ? otherUser : null);
            
            if (donorUser) {
                donorWindow = donorUser.chatWindow;
                const chatCheck = isChatAllowed(chatDay, donorUser);
                if (!chatCheck.allowed) {
                    isChatRestricted = true;
                    restrictionReason = chatCheck.reason;
                }
            }
        }

        res.render('pages/messages/index', { 
            title: res.__('chat_with', { name: otherUser.name }),
            contacts: Array.from(contactsMap.values()),
            activeContact: otherUser,
            chatHistory,
            chatRequest,
            isBlocked,
            blockReason,
            isChatRestricted,
            restrictionReason,
            chatDayName,
            donorWindow
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.getChatData = async (req, res) => {
    try {
        const userId = req.user._id;
        const otherUserId = req.params.userId;

        const chatHistory = await Message.find({
            $or: [
                { sender: userId, receiver: otherUserId },
                { sender: otherUserId, receiver: userId }
            ]
        }).sort({ createdAt: 1 });

        const otherUser = formatUserForChat(await User.findById(otherUserId), res);
        if (!otherUser) {
            return res.status(404).json({ error: res.__('flash_user_not_found') });
        }
        
        // Find the chat request and its consent status
        const chatRequest = await ChatRequest.findOne({
            $or: [
                { donor: userId, family: otherUserId },
                { donor: otherUserId, family: userId }
            ],
            status: 'approved'
        });

        // Mark as read
        await Message.updateMany(
            { sender: otherUserId, receiver: userId, isRead: false },
            { isRead: true }
        );

        // Check for Bans
        let isBlocked = false;
        let blockReason = '';
        const isSupport = otherUser.role === 'admin' || otherUser.role === 'super_admin';

        if (req.user.globalCommBan && !isSupport) {
            isBlocked = true;
            blockReason = req.user.globalCommBanReason || res.__('error_account_banned_global');
        } else if (otherUser.globalCommBan && !req.user.role?.includes('admin')) {
            isBlocked = true;
            blockReason = res.__('error_user_banned_global');
        } else {
            const blockCheck = isCommunicationBlocked(req.user, otherUser);
            
            console.log(`[NUCLEAR-DEBUG] getChatData Check:`);
            console.log(` - Result: ${blockCheck.blocked ? 'BLOCKED' : 'ALLOWED'}`);
            if (blockCheck.blocked) console.log(` - Details: By ${blockCheck.by}, Reason: ${blockCheck.reason}`);

            if (blockCheck.blocked) {
                isBlocked = true;
                blockReason = blockCheck.reason || res.__('error_comm_blocked_admin');
            }
        }

        // === Chat Day / Window Enforcement ===
        let isChatRestricted = false;
        let restrictionReason = '';
        let chatDayName = '';
        let donorWindow = null;
        
        if (!isSupport && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
            const { getChatDay, isChatAllowed, DAY_NAMES_AR } = require('../utils/chatUtils');
            const chatDay = await getChatDay();
            chatDayName = DAY_NAMES_AR[chatDay];
            const donorUser = req.user.role === 'donor' ? req.user : (otherUser.role === 'donor' ? otherUser : null);
            
            if (donorUser) {
                donorWindow = donorUser.chatWindow;
                const chatCheck = isChatAllowed(chatDay, donorUser);
                if (!chatCheck.allowed) {
                    isChatRestricted = true;
                    restrictionReason = chatCheck.reason;
                }
            }
        }

        res.json({
            success: true,
            chatHistory,
            otherUser,
            chatRequest,
            isBlocked,
            blockReason,
            isChatRestricted,
            restrictionReason,
            chatDayName,
            donorWindow,
            currentUser: {
                _id: req.user._id,
                role: req.user.role
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: res.__('error_server') });
    }
};

exports.acceptMonitoring = async (req, res) => {
    try {
        const { chatRequestId } = req.body;
        const userId = req.user._id;

        const chatRequest = await ChatRequest.findById(chatRequestId);
        if (!chatRequest) return res.status(404).json({ error: res.__('flash_request_not_found') });

        if (chatRequest.donor.equals(userId)) {
            chatRequest.donorAgreed = true;
        } else if (chatRequest.family.equals(userId)) {
            chatRequest.familyAgreed = true;
        } else {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        await chatRequest.save();

        // Notify other party in real-time
        const io = req.app.get('io');
        const otherUserId = chatRequest.donor.equals(userId) ? chatRequest.family : chatRequest.donor;

        // Phase 14: If donor agrees first, notify the family explicitly
        if (chatRequest.donor.equals(userId) && !chatRequest.familyAgreed) {
            try {
                const notif = await Notification.create({
                    sender: userId,
                    recipient: otherUserId,
                    title: res.__('notif_donor_waiting_title'),
                    message: res.__('notif_donor_waiting_msg'),
                    type: 'info',
                    targetType: 'specific',
                    link: `/messages/${userId}`
                });

                if (io) {
                    io.to(otherUserId.toString()).emit('newNotification', {
                        title: notif.title,
                        message: notif.message,
                        type: notif.type,
                        link: notif.link
                    });
                }
            } catch (notifErr) {
                console.error('Failed to create consent notification:', notifErr);
            }
        }

        if (io) {
            io.to(otherUserId.toString()).emit('consentStatusChanged', { 
                chatRequestId: chatRequest._id,
                donorAgreed: chatRequest.donorAgreed,
                familyAgreed: chatRequest.familyAgreed
            });
        }

        res.json({ success: true, chatRequest });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: res.__('error_server') });
    }
};

exports.sendMessage = async (req, res) => {
    try {
        const { receiverId, content, caseId, chatRequestId } = req.body;
        let imageUrl = null;
        const receiver = await User.findById(receiverId);
        if (!receiver) return res.status(404).json({ error: res.__('error_receiver_not_found') });

        // 1. Enforcement of Bans & Day Restrictions (STRICT)
        const isSupport = receiver.role === 'admin' || receiver.role === 'super_admin';
        
        // Global Ban Check
        if (req.user.globalCommBan && !isSupport) {
            return res.status(403).json({ error: res.__('error_account_banned_support_only') });
        }

        // Specific Pair Ban Check (Nuclear)
        const blockCheck = isCommunicationBlocked(req.user, receiver);
        if (blockCheck.blocked) {
            return res.status(403).json({ error: res.__('error_user_banned_global') });
        }

        // Chat Day / Window Enforcement
        if (!isSupport && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
            const { getChatDay, isChatAllowed } = require('../utils/chatUtils');
            const chatDay = await getChatDay();
            const donorUser = req.user.role === 'donor' ? req.user : (receiver.role === 'donor' ? receiver : null);
            
            if (donorUser) {
                const chatCheck = isChatAllowed(chatDay, donorUser);
                if (!chatCheck.allowed) {
                    return res.status(403).json({ error: chatCheck.reason, code: 'CHAT_DAY_RESTRICTED' });
                }
            }
        }

        // 2. Handle image upload if present (ONLY after security clearance)
        if (req.file) {
            try {
                const result = await cloudinary.uploader.upload(req.file.path, {
                    folder: 'jussur/chat'
                });
                imageUrl = result.secure_url;
                fs.unlinkSync(req.file.path);
            } catch (uploadErr) {
                console.error('Cloudinary upload error:', uploadErr);
                return res.status(500).json({ error: res.__('flash_upload_error') });
            }
        }

        if (!content && !imageUrl) {
            return res.status(400).json({ error: res.__('error_msg_empty') });
        }
        
        // 2. Ensure chat is approved AND AGREED by both
        const existingRequest = await ChatRequest.findOne({
            $or: [
                { donor: req.user._id, family: receiverId },
                { donor: receiverId, family: req.user._id }
            ],
            status: 'approved'
        });

        if (!existingRequest) {
            return res.status(403).json({ error: res.__('error_comm_approval_required') });
        }

        if (!existingRequest.donorAgreed || !existingRequest.familyAgreed) {
            return res.status(403).json({ error: res.__('error_comm_consent_required'), code: 'CONSENT_REQUIRED' });
        }

        // 3. Create message
        const message = await Message.create({
            sender: req.user._id,
            receiver: receiverId,
            content: content || '',
            imageUrl: imageUrl,
            case: caseId || existingRequest.case,
            chatRequest: chatRequestId || existingRequest._id
        });

        // 4. Emit real-time event
        const io = req.app.get('io');
        if (io) {
            const socketData = {
                senderId: req.user._id.toString(),
                senderName: req.user.name,
                receiverId: receiverId,
                content: message.content,
                imageUrl: message.imageUrl,
                createdAt: message.createdAt
            };
            io.to(receiverId).emit('newMessage', socketData);
            io.to(req.user._id.toString()).emit('newMessage', socketData);
        }

        return res.json({ success: true, message });
    } catch (err) {
        console.error('Send message error:', err);
        res.status(500).json({ error: res.__('flash_register_error') });
    }
};

exports.requestChat = async (req, res) => {
    try {
        const { caseId } = req.body;
        const foundCase = await Case.findById(caseId).populate('guardian');
        
        if (!foundCase) {
            return res.status(404).json({ error: res.__('flash_case_not_found') });
        }

        // Enforcement of Bans
        if (req.user.globalCommBan) {
            return res.status(403).json({ error: res.__('error_chat_request_banned') });
        }

        const guardianId = (foundCase.guardian._id || foundCase.guardian).toString();
        const isLocallyBlocked = req.user.blockedUsers.some(b => getUserId(b) === guardianId);
        const isRemotelyBlocked = foundCase.guardian.blockedUsers?.some(b => getUserId(b) === req.user._id.toString());

        if (isLocallyBlocked || isRemotelyBlocked) {
            return res.status(403).json({ error: res.__('error_comm_not_allowed_guardian') });
        }

        // Check if already requested for this FAMILY
        const existing = await ChatRequest.findOne({
            donor: req.user._id,
            family: foundCase.guardian._id || foundCase.guardian
        });

        if (existing) {
            if (existing.status === 'approved') {
                return res.json({ 
                    success: true, 
                    alreadyApproved: true,
                    message: res.__('msg_already_approved'),
                    link: `/messages/${existing.donor.equals(req.user._id) ? existing.family : existing.donor}`
                });
            }
            return res.json({ 
                message: res.__('msg_already_requested'), 
                status: existing.status 
            });
        }

        const newRequest = await ChatRequest.create({
            donor: req.user._id,
            case: caseId, // Store the first case that triggered the request
            family: foundCase.guardian
        });

        const { logActivity } = require('../utils/logger');
        await logActivity(req.user._id, 'chat_request_create', 'ChatRequest', newRequest._id, 
            res.__('log_chat_request_created', { title: foundCase.title }));

        res.json({ success: true, message: res.__('msg_request_sent_success') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: res.__('flash_register_error') });
    }
};

exports.adminGetRequests = async (req, res) => {
    try {
        const requests = await ChatRequest.find()
            .populate('donor family case')
            .sort({ createdAt: -1 });
            
        res.render('pages/admin/chat-requests', {
            title: res.__('admin_nav_chat_requests'),
            requests
        });
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

exports.adminHandleRequest = async (req, res) => {
    try {
        const { logActivity } = require('../utils/logger');
        const { requestId, status, adminComment } = req.body;
        
        await ChatRequest.findByIdAndUpdate(requestId, {
            status,
            adminComment
        });

        await logActivity(req.user._id, 'chat_request_handle', 'ChatRequest', requestId, 
            res.__('log_chat_request_handled', { status, comment: adminComment || res.__('msg_no_comment') }));

        req.flash('success', res.__('flash_request_updated'));
        res.redirect('/admin/chat-requests');
    } catch (err) {
        console.error(err);
        res.status(500).send(res.__('error_server'));
    }
};

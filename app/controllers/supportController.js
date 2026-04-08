const SupportTicket = require('../models/SupportTicket');
const Message = require('../models/Message');
const User = require('../models/User');
const { logActivity } = require('../utils/logger');

exports.getSupportPage = async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
        const adminTicketId = req.query.adminTicketId;

        let ticket;
        if (isAdmin && adminTicketId) {
            ticket = await SupportTicket.findById(adminTicketId).populate('user', 'name avatar email role');
        } else {
            // Find existing open/in_progress ticket for user
            ticket = await SupportTicket.findOne({ 
                user: req.user._id, 
                status: { $in: ['open', 'in_progress'] } 
            });
        }
        
        let messages = [];
        if (ticket) {
            messages = await Message.find({ supportTicket: ticket._id })
                .sort({ createdAt: 1 })
                .populate('sender', 'name avatar role');
        }

        res.render('pages/support/chat', {
            title: isAdmin ? 'الرد على الاستفسارات' : 'الدعم الفني | سُبُل',
            ticket,
            messages,
            user: req.user,
            isAdmin
        });
    } catch (error) {
        console.error('Support Page Error:', error);
        res.status(500).render('error', { message: 'حدث خطأ أثناء تحميل صفحة الدعم' });
    }
};

exports.openTicket = async (req, res) => {
    try {
        const existingTicket = await SupportTicket.findOne({
            user: req.user._id,
            status: { $in: ['open', 'in_progress'] }
        });

        if (existingTicket) {
            return res.status(400).json({ message: 'لديك تذكرة مفتوحة بالفعل' });
        }

        const newTicket = new SupportTicket({
            user: req.user._id,
            subject: req.body.subject || 'طلب دعم فني جديد'
        });

        await newTicket.save();

        // Log the activity
        await logActivity(req.user._id, 'chat_request_create', 'SupportTicket', newTicket._id, 
            `فتح تذكرة دعم فني جديدة برقم: ${newTicket._id.toString().slice(-6).toUpperCase()}`);

        res.status(201).json(newTicket);
    } catch (error) {
        res.status(500).json({ message: 'فشل في فتح تذكرة جديدة' });
    }
};

exports.sendMessage = async (req, res) => {
    try {
        const { ticketId, content } = req.body;
        const ticket = await SupportTicket.findById(ticketId);

        if (!ticket || ticket.status === 'closed') {
            return res.status(400).json({ message: 'التذكرة مغلقة أو غير موجودة' });
        }

        // If user is admin, they are responding. If user is ticket owner, they are asking.
        const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
        
        const newMessage = new Message({
            sender: req.user._id,
            receiver: isAdmin ? ticket.user : null, // If admin sends, receiver is the user. 
            supportTicket: ticketId,
            content
        });

        await newMessage.save();
        
        // Update ticket last activity
        ticket.lastMessageAt = Date.now();
        if (isAdmin && ticket.status === 'open') {
            ticket.status = 'in_progress';
        }
        await ticket.save();

        res.status(201).json(newMessage);
    } catch (error) {
        res.status(500).json({ message: 'فشل في إرسال الرسالة' });
    }
};

exports.getAdminSupportDashboard = async (req, res) => {
    try {
        const tickets = await SupportTicket.find()
            .populate('user', 'name avatar email')
            .sort({ lastMessageAt: -1 });

        res.render('admin/support/dashboard', {
            title: 'لوحة التحكم | الدعم الفني المشترك',
            tickets,
            user: req.user
        });
    } catch (error) {
        res.status(500).render('error', { message: 'حدث خطأ في تحميل لوحة الدعم' });
    }
};

exports.resolveTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const ticket = await SupportTicket.findById(id);

        if (!ticket) {
            return res.status(404).json({ success: false, message: 'التذكرة غير موجودة' });
        }

        ticket.status = 'resolved';
        ticket.lastMessageAt = Date.now();
        await ticket.save();

        // Add automated resolution message
        const resolutionMessage = new Message({
            sender: req.user._id,
            receiver: ticket.user,
            supportTicket: id,
            content: '✅ تم وضع علامة على هذا الطلب بأنه "تم الحل" من قبل فريق الدعم. شكراً لتواصلك معنا.'
        });
        await resolutionMessage.save();

        // Emit real-time notification
        const io = req.app.get('io');
        if (io) {
            io.to(ticket.user.toString()).emit('ticketResolved', {
                ticketId: id,
                message: resolutionMessage.content
            });
            // Also notify the specific room
            io.to(id.toString()).emit('newSupportMessage', resolutionMessage);
        }

        // Add to administrative activity log
        await logActivity(req.user._id, 'chat_request_handle', 'SupportTicket', id, 
            `تم حل تذكرة الدعم بنجاح (رقم: ${id.toString().slice(-6).toUpperCase()}) وإرسال رسالة الإغلاق للمستخدم.`);

        res.json({ success: true, message: 'تم تحديد الطلب كـ "تم الحل" بنجاح' });
    } catch (error) {
        console.error('Resolve Ticket Error:', error);
        res.status(500).json({ success: false, message: 'فشل في إغلاق الطلب' });
    }
};

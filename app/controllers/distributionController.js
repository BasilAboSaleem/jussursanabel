const Transaction = require('../models/Transaction');
const Case = require('../models/Case');
const Payout = require('../models/Payout');
const BankReceipt = require('../models/BankReceipt');
const Notification = require('../models/Notification');
const { cloudinary } = require('../utils/cloudinary');
const { logActivity } = require('../utils/logger');
const { buildExcel } = require('../utils/excelXml');
const {
    getGatewayFee,
    getInstitutionFee,
    getBankExpectedTotal
} = require('../utils/transactionFees');

function dateRange(from, to) {
    const q = {};
    if (from || to) {
        q.createdAt = {};
        if (from) q.createdAt.$gte = new Date(from + 'T00:00:00');
        if (to)   q.createdAt.$lte = new Date(to   + 'T23:59:59');
    }
    return q;
}

function verifiedDateRange(from, to) {
    if (!from && !to) return null;
    const range = {};
    if (from) range.$gte = new Date(from + 'T00:00:00');
    if (to) range.$lte = new Date(to + 'T23:59:59');
    return range;
}

function buildPendingDisbursementMatch(from, to) {
    const match = {
        status: 'verified',
        isBankConfirmed: true,
        disbursementStatus: 'pending'
    };

    const range = verifiedDateRange(from, to);
    if (range) {
        match.$or = [
            { verifiedAt: range },
            {
                $and: [
                    { $or: [{ verifiedAt: null }, { verifiedAt: { $exists: false } }] },
                    { createdAt: range }
                ]
            }
        ];
    }

    return match;
}

async function getBankDisbursementBatch({ from, to }) {
    const rows = await Transaction.aggregate([
        { $match: buildPendingDisbursementMatch(from, to) },
        {
            $lookup: {
                from: 'cases',
                localField: 'case',
                foreignField: '_id',
                as: 'caseDoc'
            }
        },
        { $unwind: '$caseDoc' },
        {
            $group: {
                _id: '$caseDoc.guardian',
                totalAmount: { $sum: { $ifNull: ['$netDonationAmount', '$amount'] } },
                donationCount: { $sum: 1 },
                caseIds: { $addToSet: '$case' }
            }
        },
        {
            $lookup: {
                from: 'users',
                localField: '_id',
                foreignField: '_id',
                as: 'user'
            }
        },
        { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
        { $sort: { totalAmount: -1 } }
    ]);

    return rows.map((row, index) => {
        const user = row.user || {};
        const payment = user.paymentDetails || {};
        const iban = (payment.iban || '').replace(/\s+/g, '').toUpperCase();
        const beneficiaryName = (payment.accountHolder || user.name || '—').trim();

        return {
            index: index + 1,
            beneficiaryName,
            iban: iban || '—',
            phone: user.phone || user.whatsapp || user.altPhone || '—',
            amount: Math.round((row.totalAmount + Number.EPSILON) * 100) / 100,
            donationCount: row.donationCount,
            caseCount: (row.caseIds || []).length,
            guardianId: row._id,
            missingIban: !iban
        };
    });
}

function roundMoney(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** @deprecated Use getInstitutionFee — kept for internal bank reconciliation only */
function getOperationFee(t) {
    return getInstitutionFee(t);
}

function getNetDonation(t) {
    if (t.netDonationAmount !== undefined && t.netDonationAmount !== null) {
        return t.netDonationAmount;
    }
    return t.amount || 0;
}

async function notifyGuardian(req, guardianId, { title, message, link, type = 'success' }) {
    if (!guardianId) return;

    const notification = await Notification.create({
        recipient: guardianId,
        sender: req.user._id,
        title,
        message,
        type,
        targetType: 'specific',
        link
    });

    const io = req.app.get('io');
    if (io) {
        io.to(guardianId.toString()).emit('newNotification', notification);
    }
}

async function fetchCaseDisbursementBatch({ from, to }) {
    const rows = await Transaction.aggregate([
        { $match: buildPendingDisbursementMatch(from, to) },
        {
            $group: {
                _id: '$case',
                totalAmount: { $sum: { $ifNull: ['$netDonationAmount', '$amount'] } },
                donationCount: { $sum: 1 },
                transactionIds: { $push: '$_id' }
            }
        },
        {
            $lookup: {
                from: 'cases',
                localField: '_id',
                foreignField: '_id',
                as: 'caseDetails'
            }
        },
        { $unwind: '$caseDetails' },
        {
            $lookup: {
                from: 'users',
                localField: 'caseDetails.guardian',
                foreignField: '_id',
                as: 'recipientDetails'
            }
        },
        { $unwind: { path: '$recipientDetails', preserveNullAndEmptyArrays: true } },
        { $sort: { totalAmount: -1 } }
    ]);

    return rows.map((item) => ({
        caseId: item._id,
        title: item.caseDetails.title,
        guardianName: item.recipientDetails?.name || '—',
        guardianId: item.caseDetails.guardian,
        totalAmount: roundMoney(item.totalAmount),
        donationCount: item.donationCount,
        transactionIds: item.transactionIds,
        recipient: item.recipientDetails || {}
    }));
}

async function processSinglePayout(req, {
    caseId,
    transactionIds,
    notes = '',
    paymentMethod = 'Bank Transfer',
    receiptImage = '',
    allowMultiplePayouts = false
}) {
    if (!caseId || !transactionIds || transactionIds.length === 0) {
        throw new Error('Missing required fields');
    }

    const transactions = await Transaction.find({ _id: { $in: transactionIds } });

    const alreadyDisbursed = transactions.find((t) => t.disbursementStatus === 'disbursed');
    if (alreadyDisbursed) {
        throw new Error('One or more transactions are already disbursed');
    }

    const notReady = transactions.find((t) => !t.isBankConfirmed || t.status !== 'verified');
    if (notReady) {
        throw new Error('Transactions must be bank-confirmed before disbursement');
    }

    const existingPayout = await Payout.findOne({ case: caseId });
    if (existingPayout && !allowMultiplePayouts) {
        throw new Error(req.__('msg_case_already_paid') || 'Case already has a payout');
    }

    let calculatedAmount = 0;
    transactions.forEach((t) => {
        calculatedAmount += getNetDonation(t);
    });
    calculatedAmount = roundMoney(calculatedAmount);

    const datePart = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const randomPart = Math.floor(1000 + Math.random() * 9000);
    const payoutNumber = `PAY-${datePart}-${randomPart}`;

    let receiptImageUrl = '';
    if (receiptImage && receiptImage.startsWith('data:image')) {
        try {
            const result = await cloudinary.uploader.upload(receiptImage, {
                folder: 'jussur-sanabel/payouts'
            });
            receiptImageUrl = result.secure_url;
        } catch (uploadErr) {
            console.error('Cloudinary Payout Receipt Upload Error:', uploadErr);
        }
    }

    const payout = new Payout({
        case: caseId,
        amount: calculatedAmount,
        payoutNumber,
        paymentMethod,
        transactions: transactionIds,
        notes: notes || '',
        receiptImage: receiptImageUrl,
        createdBy: req.user._id
    });
    await payout.save();

    await Transaction.updateMany(
        { _id: { $in: transactionIds } },
        { $set: { disbursementStatus: 'disbursed' } }
    );

    const targetCase = await Case.findById(caseId);
    if (targetCase) {
        const updateMsg = `تأكيد مالي: تم بنجاح تحويل مبلغ $${calculatedAmount} لصالح الحالة عبر (${paymentMethod}) كجزء من دورة التوزيع الموثقة. تم إصدار سند صرف رقم ${payoutNumber}.`;

        targetCase.updates.push({
            title: 'سند صرف وتوزيع معتمد',
            content: updateMsg,
            images: receiptImageUrl ? [receiptImageUrl] : [],
            postedBy: 'admin',
            createdAt: new Date()
        });
        await targetCase.save();

        if (targetCase.guardian) {
            await notifyGuardian(req, targetCase.guardian, {
                title: req.__('notif_payout_generated_title'),
                message: req.__('notif_payout_generated_msg', { amount: calculatedAmount }),
                link: `/cases/${targetCase._id}`
            });
        }
    }

    await logActivity(
        req.user._id,
        'payout_generate',
        'Payout',
        payout._id,
        `Generated payout ${payoutNumber} of $${calculatedAmount} for case ${caseId} via ${paymentMethod}`
    );

    return { payout, payoutNumber, amount: calculatedAmount, caseId };
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

/* ─────────────────────────────────────────────
   EXPORT 4: Bank disbursement batch for Housing Bank
   ───────────────────────────────────────────── */
exports.exportBankDisbursementBatch = async (req, res) => {
    try {
        const { from, to } = req.query;
        if (!from || !to) {
            return res.status(400).send('from and to dates are required');
        }

        const batch = await getBankDisbursementBatch({ from, to });

        const headers = [
            '#',
            'اسم المستفيد',
            'رقم الآيبان (IBAN)',
            'رقم الهاتف',
            'المبلغ المستحق للصرف ($)',
            'عدد التبرعات'
        ];

        const rows = batch.map((item) => [
            item.index,
            item.beneficiaryName,
            item.iban,
            item.phone,
            item.amount,
            item.donationCount
        ]);

        const label = from && to ? `${from}_to_${to}` : from || to || 'all-pending';
        const colWidths = [40, 220, 240, 140, 160, 110];
        const periodNote = from && to ? `الفترة: من ${from} إلى ${to}` : 'جميع التبرعات المؤكدة بنكياً وقيد الصرف';

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bank-disbursement-${label}.xls"`);
        res.send(buildExcel(`صرف المستفيدين — ${periodNote}`, headers, rows, colWidths));
    } catch (err) {
        console.error(err);
        res.status(500).send('Export error');
    }
};

/* ─────────────────────────────────────────────
   EXPORT 1: Pending Bank Transactions
   ───────────────────────────────────────────── */
exports.exportBankTransactions = async (req, res) => {
    try {
        const { from, to } = req.query;
        const q = { status: 'verified', isBankConfirmed: false, ...dateRange(from, to) };
        const transactions = await Transaction.find(q)
            .populate('donor')
            .populate({
                path: 'case',
                populate: { path: 'guardian', select: 'name' }
            })
            .sort({ createdAt: -1 });

        const headers = ['#', 'رقم المعاملة', 'اسم المتبرع', 'الحالة المستفيدة', 'مقدم الحالة', 'مبلغ التبرع ($)', 'رسوم Stripe (معلوماتية)', 'رسوم المؤسسة ($)', 'المتوقع في البنك ($)', 'نوع التبرع', 'تاريخ المعاملة'];
        const rows = transactions.map((t, i) => [
            i + 1,
            String(t._id).slice(-8).toUpperCase(),
            t.donor ? t.donor.name : '—',
            t.case  ? t.case.title  : '—',
            (t.case && t.case.guardian) ? t.case.guardian.name : '—',
            t.amount || 0,
            getGatewayFee(t),
            getInstitutionFee(t),
            getBankExpectedTotal(t),
            t.type === 'monthly' ? 'كفالة شهرية' : 'تبرع مباشر',
            fmtDate(t.createdAt)
        ]);

        const label = from && to ? `${from}_to_${to}` : 'full';
        const colWidths = [40, 130, 200, 250, 200, 100, 120, 100, 120, 120];

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="bank-transactions-${label}.xls"`);
        res.send(buildExcel('المعاملات البنكية المعلقة', headers, rows, colWidths));
    } catch (err) {
        console.error(err);
        res.status(500).send('Export error');
    }
};

/* ─────────────────────────────────────────────
   EXPORT 2: Bank Receipts History
   ───────────────────────────────────────────── */
exports.exportReceiptsHistory = async (req, res) => {
    try {
        const { from, to } = req.query;
        const q = dateRange(from, to);
        const receipts = await BankReceipt.find(q).populate('createdBy', 'name').sort({ createdAt: -1 });

        const headers = ['#', 'الرقم المرجعي', 'المبلغ المتوقع ($)', 'مبلغ الرسوم ($)', 'الإجمالي المتوقع ($)', 'المبلغ الفعلي المستلم ($)', 'الفارق ($)', 'الإجراء عند النقص', 'المسؤول', 'ملاحظات', 'تاريخ المطابقة'];
        const rows = receipts.map((r, i) => [
            i + 1,
            r.reference || '—',
            r.expectedDonations || 0,
            r.expectedOperationalFees || 0,
            r.expectedTotal || 0,
            r.actualReceived || 0,
            r.variance || 0,
            r.shortfallAction === 'deduct_from_fees' ? 'خصم من الرسوم' :
            r.shortfallAction === 'deduct_from_cases' ? 'خصم من الحالات' : 'لا يوجد فارق',
            r.createdBy ? r.createdBy.name : '—',
            r.notes || '—',
            fmtDate(r.createdAt)
        ]);

        const label = from && to ? `${from}_to_${to}` : 'full';
        const colWidths = [40, 130, 140, 120, 150, 170, 100, 150, 150, 250, 120];

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="receipts-history-${label}.xls"`);
        res.send(buildExcel('سجل المطابقات البنكية', headers, rows, colWidths));
    } catch (err) {
        console.error(err);
        res.status(500).send('Export error');
    }
};

/* ─────────────────────────────────────────────
   EXPORT 3: Payouts History
   ───────────────────────────────────────────── */
exports.exportPayoutsHistory = async (req, res) => {
    try {
        const { from, to } = req.query;
        const q = dateRange(from, to);
        const payouts = await Payout.find(q).populate({
            path: 'case',
            populate: { path: 'guardian', select: 'name' }
        }).sort({ createdAt: -1 });

        const headers = ['#', 'رقم سند الصرف', 'الحالة المستفيدة', 'مقدم الحالة', 'المبلغ الموزع ($)', 'وسيلة الدفع', 'ملاحظات', 'تاريخ الصرف'];
        const rows = payouts.map((p, i) => [
            i + 1,
            p.payoutNumber || '—',
            p.case ? p.case.title : '—',
            (p.case && p.case.guardian) ? p.case.guardian.name : '—',
            p.amount || 0,
            p.paymentMethod || '—',
            p.notes || '—',
            fmtDate(p.createdAt)
        ]);

        const label = from && to ? `${from}_to_${to}` : 'full';
        const colWidths = [40, 130, 250, 200, 140, 120, 250, 120];

        res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="payouts-history-${label}.xls"`);
        res.send(buildExcel('سجل سندات الصرف والمدفوعات', headers, rows, colWidths));
    } catch (err) {
        console.error(err);
        res.status(500).send('Export error');
    }
};


/**
 * Get Distribution Center (Main View)
 */
exports.getDistributionCenter = async (req, res) => {
    try {
        const { bankFrom, bankTo, receiptFrom, receiptTo, disburseFrom, disburseTo } = req.query;
        
        // --- 1. Filter: Pending Bank Confirmation ---
        let bankQuery = { 
            status: 'verified', 
            isBankConfirmed: false 
        };
        if (bankFrom || bankTo) {
            bankQuery.createdAt = {};
            if (bankFrom) bankQuery.createdAt.$gte = new Date(bankFrom + 'T00:00:00');
            if (bankTo) bankQuery.createdAt.$lte = new Date(bankTo + 'T23:59:59');
        }

        const pendingBankConfirmation = await Transaction.find(bankQuery)
            .populate('donor')
            .populate({
                path: 'case',
                populate: { path: 'guardian', select: 'name' }
            })
            .sort({ createdAt: -1 });

        const bankFilteredTotals = {
            donations: 0,
            fees: 0,
            gatewayFees: 0,
            grandTotal: 0,
            count: pendingBankConfirmation.length
        };
        pendingBankConfirmation.forEach(t => {
            const institutionFee = getInstitutionFee(t);
            bankFilteredTotals.donations += t.amount || 0;
            bankFilteredTotals.fees += institutionFee;
            bankFilteredTotals.gatewayFees += getGatewayFee(t);
            bankFilteredTotals.grandTotal += (t.amount || 0) + institutionFee;
        });

        const readyMatch = disburseFrom && disburseTo
            ? buildPendingDisbursementMatch(disburseFrom, disburseTo)
            : { status: 'verified', isBankConfirmed: true, disbursementStatus: 'pending' };

        // --- 2. Aggregate: Ready for Disbursement ---
        const readyForDisbursement = await Transaction.aggregate([
            { $match: readyMatch },
            {
                $group: {
                    _id: '$case',
                    totalQuantity: { $sum: 1 },
                    totalAmount: { $sum: { $ifNull: ['$netDonationAmount', '$amount'] } },
                    transactionIds: { $push: '$_id' }
                }
            },
            {
                $lookup: {
                    from: 'cases',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'caseDetails'
                }
            },
            { $unwind: '$caseDetails' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'caseDetails.guardian',
                    foreignField: '_id',
                    as: 'recipientDetails'
                }
            },
            { $unwind: { path: '$recipientDetails', preserveNullAndEmptyArrays: true } }
        ]);

        const bankDisbursementBatch = (disburseFrom && disburseTo)
            ? await getBankDisbursementBatch({ from: disburseFrom, to: disburseTo })
            : [];
        const disbursementCaseBatch = (disburseFrom && disburseTo)
            ? await fetchCaseDisbursementBatch({ from: disburseFrom, to: disburseTo })
            : [];
        const bankDisbursementTotals = {
            beneficiaries: bankDisbursementBatch.length,
            totalAmount: roundMoney(bankDisbursementBatch.reduce((sum, row) => sum + row.amount, 0)),
            donations: bankDisbursementBatch.reduce((sum, row) => sum + row.donationCount, 0),
            missingIban: bankDisbursementBatch.filter((row) => row.missingIban).length
        };

        // --- 3. Filter & Paginate: Bank Receipts History ---
        const receiptPage = parseInt(req.query.receiptPage) || 1;
        const receiptLimit = 10;
        const receiptSkip = (receiptPage - 1) * receiptLimit;

        let receiptHistoryQuery = {};
        if (receiptFrom || receiptTo) {
            receiptHistoryQuery.createdAt = {};
            if (receiptFrom) receiptHistoryQuery.createdAt.$gte = new Date(receiptFrom + 'T00:00:00');
            if (receiptTo) receiptHistoryQuery.createdAt.$lte = new Date(receiptTo + 'T23:59:59');
        }

        const totalReceipts = await BankReceipt.countDocuments(receiptHistoryQuery);
        const recentReceipts = await BankReceipt.find(receiptHistoryQuery)
            .populate('createdBy', 'name')
            .sort({ createdAt: -1 })
            .skip(receiptSkip)
            .limit(receiptLimit);

        const historyPeriodTotals = {
            totalExpected: 0,
            totalActual: 0,
            totalVariance: 0,
            count: totalReceipts
        };
        // Compute totals for all filtered results (not just current page) for better analytics
        const allFilteredReceipts = await BankReceipt.find(receiptHistoryQuery).select('expectedTotal actualReceived variance');
        allFilteredReceipts.forEach(r => {
            historyPeriodTotals.totalExpected += (r.expectedTotal || 0);
            historyPeriodTotals.totalActual += (r.actualReceived || 0);
            historyPeriodTotals.totalVariance += (r.variance || 0);
        });

        // --- 4. Filter & Paginate: Recent Payouts History ---
        const payoutPage = parseInt(req.query.payoutPage) || 1;
        const payoutLimit = 10;
        const payoutSkip = (payoutPage - 1) * payoutLimit;

        const { payoutFrom, payoutTo } = req.query;
        let payoutHistoryQuery = {};
        if (payoutFrom || payoutTo) {
            payoutHistoryQuery.createdAt = {};
            if (payoutFrom) payoutHistoryQuery.createdAt.$gte = new Date(payoutFrom + 'T00:00:00');
            if (payoutTo) payoutHistoryQuery.createdAt.$lte = new Date(payoutTo + 'T23:59:59');
        }

        const totalPayouts = await Payout.countDocuments(payoutHistoryQuery);
        const recentPayouts = await Payout.find(payoutHistoryQuery)
            .populate({ path: 'case', populate: { path: 'guardian', select: 'name' } })
            .sort({ createdAt: -1 })
            .skip(payoutSkip)
            .limit(payoutLimit);

        const payoutPeriodTotals = {
            totalAmount: 0,
            count: totalPayouts
        };
        const allFilteredPayouts = await Payout.find(payoutHistoryQuery).select('amount');
        allFilteredPayouts.forEach(p => {
            payoutPeriodTotals.totalAmount += (p.amount || 0);
        });

        // --- 5. Global Stats & Analytics ---
        let stats = {
            pendingStripeDonations: 0,
            pendingStripeInstitutionFees: 0,
            pendingStripeGatewayFees: 0,
            pendingStripeTotal: 0,
            readyBankTotal: 0,
            totalDisbursed: 0
        };

        pendingBankConfirmation.forEach(t => {
            stats.pendingStripeDonations += t.amount || 0;
            stats.pendingStripeInstitutionFees += getInstitutionFee(t);
            stats.pendingStripeGatewayFees += getGatewayFee(t);
        });
        stats.pendingStripeTotal = roundMoney(
            stats.pendingStripeDonations + stats.pendingStripeInstitutionFees
        );

        stats.readyBankTotal = roundMoney(
            readyForDisbursement.reduce((sum, c) => sum + (c.totalAmount || 0), 0)
        );

        const totalPayoutResult = await Payout.aggregate([
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        stats.totalDisbursed = totalPayoutResult.length > 0 ? totalPayoutResult[0].total : 0;
        stats.remainingLiquidity = stats.readyBankTotal;

        res.render('pages/admin/distribution-center', {
            title: res.__('admin_sidebar_distribution'),
            stats,
            bankFrom: bankFrom || '',
            bankTo: bankTo || '',
            disburseFrom: disburseFrom || '',
            disburseTo: disburseTo || '',
            bankDisbursementBatch,
            bankDisbursementTotals,
            disbursementCaseBatch,
            bankFilteredTotals,
            receiptFrom: receiptFrom || '',
            receiptTo: receiptTo || '',
            historyPeriodTotals,
            payoutFrom: payoutFrom || '',
            payoutTo: payoutTo || '',
            payoutPeriodTotals,
            pendingBankConfirmation,
            readyForDisbursement,
            recentPayouts,
            recentReceipts,
            receiptPagination: { currentPage: receiptPage, totalPages: Math.ceil(totalReceipts / receiptLimit) },
            payoutPagination: { currentPage: payoutPage, totalPages: Math.ceil(totalPayouts / payoutLimit) },
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (err) {
        console.error(err);
        res.status(500).render('errors/error', { message: res.__('error_server') });
    }
};

/**
 * Confirm Bank Receipt
 */
exports.confirmBankReceipt = async (req, res) => {
    try {
        const { transactionIds, actualReceived, shortfallAction, notes, bankProofImage } = req.body;
        if (!transactionIds || !Array.isArray(transactionIds) || actualReceived === undefined) {
            return res.status(400).json({ success: false, message: 'Invalid data' });
        }

        const transactions = await Transaction.find({ _id: { $in: transactionIds } });
        if (transactions.length === 0) {
            return res.status(404).json({ success: false, message: 'No transactions found' });
        }

        let expectedDonations = 0;
        let expectedOperationalFees = 0;
        
        transactions.forEach(t => {
            const opFee = getOperationFee(t);
            expectedDonations += t.amount || 0;
            expectedOperationalFees += opFee;
            t.netDonationAmount = t.amount;
        });
        
        const expectedTotal = expectedDonations + expectedOperationalFees;
        const actualReceivedNum = parseFloat(actualReceived);
        const variance = expectedTotal - actualReceivedNum;

        const reference = 'BR-' + Date.now().toString().slice(-6);
        
        let proofImageUrl = '';
        if (bankProofImage && bankProofImage.startsWith('data:image')) {
            try {
                const result = await cloudinary.uploader.upload(bankProofImage, {
                    folder: 'jussur-sanabel/bank-proofs'
                });
                proofImageUrl = result.secure_url;
            } catch (err) {
                console.error('Cloudinary Bank Proof Upload Error:', err);
            }
        }
        
        const receipt = new BankReceipt({
            reference,
            expectedDonations,
            expectedOperationalFees,
            expectedTotal,
            actualReceived: actualReceivedNum,
            variance,
            shortfallAction: variance > 0 ? (shortfallAction || 'deduct_from_fees') : 'none',
            transactions: transactionIds,
            bankStatementProof: proofImageUrl,
            createdBy: req.user._id,
            notes: notes || ''
        });

        if (variance > 0 && receipt.shortfallAction === 'deduct_from_cases') {
            for (const t of transactions) {
                const ratio = t.amount / (expectedDonations || 1);
                const caseShortfall = variance * ratio;
                const newNet = Math.max(0, roundMoney(t.amount - caseShortfall));
                const deduction = roundMoney(t.amount - newNet);
                t.netDonationAmount = newNet;
                if (deduction > 0) {
                    await Case.findByIdAndUpdate(t.case, { $inc: { raisedAmount: -deduction } });
                }
            }
        }

        await receipt.save();

        const caseNotifyTotals = new Map();
        for (const t of transactions) {
            const caseKey = String(t.case);
            caseNotifyTotals.set(caseKey, (caseNotifyTotals.get(caseKey) || 0) + getNetDonation(t));
        }

        for (let t of transactions) {
            t.isBankConfirmed = true;
            t.bankReceipt = receipt._id;
            await t.save();
        }

        for (const [caseId, total] of caseNotifyTotals) {
            const targetCase = await Case.findById(caseId).select('title guardian');
            if (targetCase?.guardian) {
                await notifyGuardian(req, targetCase.guardian, {
                    title: res.__('notif_bank_confirmed_title'),
                    message: res.__('notif_bank_confirmed_msg', {
                        amount: roundMoney(total),
                        title: targetCase.title
                    }),
                    link: `/cases/${caseId}`
                });
            }
        }

        logActivity(req.user._id, 'bank_confirmation', 'BankReceipt', receipt._id, `Confirmed bank receipt ${reference} for ${transactionIds.length} transactions`);

        res.json({ success: true, message: res.__('msg_bank_confirmed_success') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('error_server') });
    }
};

/**
 * Bulk confirm disbursement for selected cases
 */
exports.confirmDisbursementBatch = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { caseIds, from, to, notes } = req.body;
        if (!from || !to) {
            return res.status(400).json({ success: false, message: res.__('admin_dist_batch_dates_required') });
        }
        if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
            return res.status(400).json({ success: false, message: res.__('admin_dist_batch_no_cases') });
        }

        const batch = await fetchCaseDisbursementBatch({ from, to });
        const batchMap = new Map(batch.map((item) => [String(item.caseId), item]));

        const processed = [];
        const errors = [];

        for (const caseId of caseIds) {
            const item = batchMap.get(String(caseId));
            if (!item) {
                errors.push({ caseId, message: res.__('admin_dist_batch_case_not_in_period') });
                continue;
            }

            try {
                const result = await processSinglePayout(req, {
                    caseId: item.caseId,
                    transactionIds: item.transactionIds,
                    notes: notes || '',
                    paymentMethod: 'Bank Transfer',
                    allowMultiplePayouts: true
                });
                processed.push(result);
            } catch (err) {
                errors.push({ caseId, message: err.message });
            }
        }

        res.json({
            success: processed.length > 0,
            processed: processed.length,
            errors,
            message: res.__('admin_dist_batch_done', { count: processed.length })
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('error_server') });
    }
};

/**
 * Generate Payout for a Case (manual)
 */
exports.generatePayout = async (req, res) => {
    try {
        const { caseId, transactionIds, notes, paymentMethod, receiptImage } = req.body;

        const result = await processSinglePayout(req, {
            caseId,
            transactionIds,
            notes,
            paymentMethod: paymentMethod || 'Bank Transfer',
            receiptImage,
            allowMultiplePayouts: req.user.role === 'super_admin'
        });

        res.json({
            success: true,
            message: res.__('msg_payout_success'),
            payoutId: result.payout._id,
            payoutNumber: result.payoutNumber
        });
    } catch (err) {
        console.error(err);
        res.status(400).json({ success: false, message: err.message || res.__('error_server') });
    }
};

/**
 * Get Bank Receipt Details (JSON for Modal)
 */
exports.getBankReceiptDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const receipt = await BankReceipt.findById(id).populate({
            path: 'transactions',
            populate: { path: 'donor case', select: 'name title' }
        });
        if (!receipt) return res.status(404).json({ success: false, message: 'Receipt not found' });
        res.json({ success: true, receipt });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

/**
 * Revert Bank Receipt Batch
 */
exports.revertBankReceipt = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        const receipt = await BankReceipt.findById(id);
        if (!receipt) return res.status(404).json({ success: false, message: 'Receipt not found' });

        if (receipt.shortfallAction === 'deduct_from_cases') {
            const transactions = await Transaction.find({ _id: { $in: receipt.transactions } });
            for (const t of transactions) {
                if (t.netDonationAmount != null && t.netDonationAmount < t.amount) {
                    const restore = roundMoney(t.amount - t.netDonationAmount);
                    await Case.findByIdAndUpdate(t.case, { $inc: { raisedAmount: restore } });
                }
            }
        }

        // 1. Mark transactions included as NOT confirmed
        await Transaction.updateMany(
            { _id: { $in: receipt.transactions } },
            { 
                $set: { 
                    isBankConfirmed: false, 
                    bankReceipt: null,
                    netDonationAmount: undefined 
                } 
            }
        );

        // 2. Delete the Bank Receipt Batch
        const ref = receipt.reference;
        await BankReceipt.findByIdAndDelete(id);

        logActivity(req.user._id, 'bank_revert', 'BankReceipt', id, `Reverted bank reconciliation batch ${ref}`);

        res.json({ success: true, message: res.__('msg_bank_reverted_success') || 'Reconciliation reverted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('error_server') });
    }
};

/**
 * Revert Payout (Cancellation)
 */
exports.revertPayout = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const { id } = req.params;
        const payout = await Payout.findById(id);
        if (!payout) return res.status(404).json({ success: false, message: 'Payout not found' });

        // 1. Mark transactions back as pending
        await Transaction.updateMany(
            { _id: { $in: payout.transactions } },
            { $set: { disbursementStatus: 'pending' } }
        );

        // 2. Add cancellation log to Case
        const targetCase = await Case.findById(payout.case);
        if (targetCase) {
            targetCase.updates.push({
                title: 'إلغاء سند صرف وتجميد توزيع',
                content: `تنبيه مالي: تم إلغاء سند الصرف رقم (${payout.payoutNumber}) بقيمة $${payout.amount} لأسباب تدقيقية. تم إعادة المبلغ لعهدة التوزيع المعلقة حتى إشعار آخر.`,
                postedBy: 'admin',
                createdAt: new Date()
            });
            await targetCase.save();
        }

        // 3. Delete payout record
        const num = payout.payoutNumber;
        await Payout.findByIdAndDelete(id);

        logActivity(req.user._id, 'payout_revert', 'Payout', id, `Reverted payout ${num}`);

        res.json({ success: true, message: res.__('msg_payout_reverted_success') || 'Payout reverted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('error_server') });
    }
};

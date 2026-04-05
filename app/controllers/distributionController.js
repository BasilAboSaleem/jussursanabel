const Transaction = require('../models/Transaction');
const Case = require('../models/Case');
const Payout = require('../models/Payout');
const BankReceipt = require('../models/BankReceipt');
const { cloudinary } = require('../utils/cloudinary');
const { logActivity } = require('../utils/logger');

/* ─────────────────────────────────────────────
   EXCEL HELPER  (SpreadsheetML – no npm needed)
   ───────────────────────────────────────────── */
function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildExcel(sheetName, headers, rows, colWidths = []) {
    const headerRow = headers.map(h =>
        `<Cell ss:StyleID="header"><Data ss:Type="String">${esc(h)}</Data></Cell>`
    ).join('');

    const columnDefs = (colWidths.length ? colWidths : headers.map(() => 160))
        .map(w => `<Column ss:AutoFitWidth="0" ss:Width="${w}"/>`)
        .join('\n      ');

    const dataRows = rows.map(row => {
        const cells = row.map(cell => {
            const isNum = typeof cell === 'number';
            return `<Cell ss:StyleID="${isNum ? 'num' : 'data'}"><Data ss:Type="${isNum ? 'Number' : 'String'}">${esc(cell)}</Data></Cell>`;
        }).join('');
        return `<Row>${cells}</Row>`;
    }).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="11"/>
      <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="2"/></Borders>
    </Style>
    <Style ss:ID="data">
      <Alignment ss:Horizontal="Right" ss:Vertical="Center" ss:WrapText="1"/>
      <Font ss:Size="10"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
    </Style>
    <Style ss:ID="num">
      <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>
      <Font ss:Size="10" ss:Bold="1"/>
      <NumberFormat ss:Format="#,##0.00"/>
      <Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders>
    </Style>
  </Styles>
  <Worksheet ss:Name="${esc(sheetName)}">
    <Table>
      ${columnDefs}
      <Row ss:AutoFitHeight="1">${headerRow}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function dateRange(from, to) {
    const q = {};
    if (from || to) {
        q.createdAt = {};
        if (from) q.createdAt.$gte = new Date(from + 'T00:00:00');
        if (to)   q.createdAt.$lte = new Date(to   + 'T23:59:59');
    }
    return q;
}

function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

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

        const headers = ['#', 'رقم المعاملة', 'اسم المتبرع', 'الحالة المستفيدة', 'مقدم الحالة', 'المبلغ ($)', 'رسوم التشغيل ($)', 'الإجمالي ($)', 'نوع التبرع', 'تاريخ المعاملة'];
        const rows = transactions.map((t, i) => [
            i + 1,
            String(t._id).slice(-8).toUpperCase(),
            t.donor ? t.donor.name : '—',
            t.case  ? t.case.title  : '—',
            (t.case && t.case.guardian) ? t.case.guardian.name : '—',
            t.amount || 0,
            t.institutionFee !== undefined ? t.institutionFee : (t.operationFee || 0),
            (t.amount || 0) + (t.institutionFee !== undefined ? t.institutionFee : (t.operationFee || 0)),
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
        const { bankFrom, bankTo, receiptFrom, receiptTo } = req.query;
        
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
            grandTotal: 0,
            count: pendingBankConfirmation.length
        };
        pendingBankConfirmation.forEach(t => {
            const instFee = t.institutionFee !== undefined ? t.institutionFee : (t.operationFee || 0);
            bankFilteredTotals.donations += t.amount;
            bankFilteredTotals.fees += instFee;
            bankFilteredTotals.grandTotal += (t.amount + instFee);
        });

        // --- 2. Aggregate: Ready for Disbursement ---
        const readyForDisbursement = await Transaction.aggregate([
            { 
                $match: { 
                    status: 'verified', 
                    isBankConfirmed: true, 
                    disbursementStatus: 'pending' 
                } 
            },
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
            pendingStripeFees: 0,
            pendingStripeTotal: 0,
            readyBankTotal: 0,
            totalDisbursed: 0
        };

        pendingBankConfirmation.forEach(t => {
            const instFee = t.institutionFee !== undefined ? t.institutionFee : (t.operationFee || 0);
            stats.pendingStripeDonations += t.amount || 0;
            stats.pendingStripeFees += instFee;
        });
        stats.pendingStripeTotal = stats.pendingStripeDonations + stats.pendingStripeFees;

        readyForDisbursement.forEach(c => {
            stats.readyBankTotal += c.totalAmount || 0;
        });

        const totalPayoutResult = await Payout.aggregate([
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        stats.totalDisbursed = totalPayoutResult.length > 0 ? totalPayoutResult[0].total : 0;
        stats.remainingLiquidity = stats.readyBankTotal - stats.totalDisbursed;

        res.render('pages/admin/distribution-center', {
            title: res.__('admin_nav_distribution'),
            stats,
            bankFrom: bankFrom || '',
            bankTo: bankTo || '',
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
            const instFee = t.institutionFee !== undefined ? t.institutionFee : (t.operationFee || 0);
            expectedDonations += t.amount || 0;
            expectedOperationalFees += instFee;
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
            transactions.forEach(t => {
                const ratio = t.amount / (expectedDonations || 1);
                const caseShortfall = variance * ratio;
                t.netDonationAmount = Math.max(0, t.amount - caseShortfall);
            });
        }

        await receipt.save();

        for (let t of transactions) {
            t.isBankConfirmed = true;
            t.bankReceipt = receipt._id;
            await t.save();
        }

        logActivity(req.user._id, 'bank_confirmation', 'BankReceipt', receipt._id, `Confirmed bank receipt ${reference} for ${transactionIds.length} transactions`);

        res.json({ success: true, message: res.__('msg_bank_confirmed_success') });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('error_server') });
    }
};

/**
 * Generate Payout for a Case
 */
exports.generatePayout = async (req, res) => {
    try {
        const { caseId, transactionIds, notes, paymentMethod, recipientName, receiptImage } = req.body;

        if (!caseId || !transactionIds || transactionIds.length === 0 || !paymentMethod) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const transactions = await Transaction.find({ _id: { $in: transactionIds } });
        
        // --- DUPLICATE PREVENTION GUARDS ---
        
        // 1. Transaction Guard: Check if any transaction is already disbursed
        const alreadyDisbursed = transactions.find(t => t.disbursementStatus === 'disbursed');
        if (alreadyDisbursed) {
            return res.status(400).json({ success: false, message: 'Wait! One or more transactions in this batch are already marked as disbursed.' });
        }

        // 2. Case Guard: Check if the case has already received a payout (as requested: "distribution to the case is done only once")
        const existingPayout = await Payout.findOne({ case: caseId });
        if (existingPayout) {
            return res.status(400).json({ 
                success: false, 
                message: res.__('msg_case_already_paid') || 'Error: Individual cases can only receive one total distribution payout in this system.' 
            });
        }

        let calculatedAmount = 0;
        transactions.forEach(t => {
            calculatedAmount += t.netDonationAmount !== undefined ? t.netDonationAmount : t.amount;
        });

        // Generate unique payout number
        const datePart = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const randomPart = Math.floor(1000 + Math.random() * 9000);
        const payoutNumber = `PAY-${datePart}-${randomPart}`;

        let receiptImageUrl = '';
        if (receiptImage && receiptImage.startsWith('data:image')) {
            try {
                // Upload base64 to Cloudinary
                const result = await cloudinary.uploader.upload(receiptImage, {
                    folder: 'jussur-sanabel/payouts'
                });
                receiptImageUrl = result.secure_url;
            } catch (uploadErr) {
                console.error('Cloudinary Payout Receipt Upload Error:', uploadErr);
            }
        }

        // 1. Create Payout entry
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

        // 2. Mark transactions as disbursed
        await Transaction.updateMany(
            { _id: { $in: transactionIds } },
            { $set: { disbursementStatus: 'disbursed' } }
        );

        // 3. Update Case Log (Automatic Update)
        const targetCase = await Case.findById(caseId);
        if (targetCase) {
            const formattedDate = new Date().toLocaleDateString('ar-EG');
            const updateMsg = `تأكيد مالي: تم بنجاح تحويل مبلغ $${calculatedAmount} لصالح الحالة عبر (${paymentMethod}) كجزء من دورة التوزيع الموثقة. تم إصدار سند صرف رقم ${payoutNumber}.`;
            
            targetCase.updates.push({
                title: 'سند صرف وتوزيع معتمد',
                content: updateMsg,
                images: receiptImageUrl ? [receiptImageUrl] : [],
                postedBy: 'admin',
                createdAt: new Date()
            });
            await targetCase.save();
        }

        logActivity(req.user._id, 'payout_generate', 'Payout', payout._id, `Generated payout ${payoutNumber} of $${calculatedAmount} for case ${caseId} via ${paymentMethod}`);

        res.json({ success: true, message: res.__('msg_payout_success'), payoutId: payout._id, payoutNumber });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: res.__('error_server') });
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

# Admin Roles Matrix

مراجعة صلاحيات `admin` مقابل `super_admin` (من `app/routes/admin.js` + `app/middlewares/auth.js`).

## أدوار المنصة

| الدور | الوصف |
|-------|--------|
| `super_admin` | تحكم كامل: إعدادات، حذف نهائي، توزيع مالي، سجلات |
| `admin` | إدارة يومية: حالات، معاملات، مستخدمين (بدون حذف نهائي أو إعدادات نظام) |
| `regulator` | إشراف قراءة فقط + تصعيدات (لا POST إدارية) |
| `media` | مراجعة وسائط الحالات فقط (مسارات محددة) |
| `support` | مستخدمون + تصعيدات (مسارات محددة في أعلى الملف) |

## `super_admin` فقط

| المسار | الإجراء |
|--------|---------|
| `POST /admin/users/create` | إنشاء حساب إداري |
| `POST /admin/users/:id/delete` | حذف مستخدم |
| `POST /admin/cases/:id/hard-delete` | حذف حالة نهائياً |
| `POST /admin/cases/:id/toggle-visibility` | إخفاء/إظهار حالة |
| `POST /admin/cases/:id/story-hard-delete` | حذف قصة نهائياً |
| `POST /admin/cases/:id/toggle-story-visibility` | إخفاء قصة |
| `GET /admin/operation-fees` | تفاصيل رسوم التشغيل |
| `GET /admin/donations-ledger` | دفتر التبرعات |
| `GET /admin/donations-ledger/export` | تصدير الدفتر |
| `GET/POST /admin/settings` | إعدادات النظام |
| `GET /admin/password-recovery` | استرداد كلمات المرور |
| `POST /admin/users/:id/temporary-password` | كلمة مرور مؤقتة |
| `GET /admin/activity-logs` | سجلات النشاط |
| `POST /admin/escalations/:id/resolve` | حل تصعيد |
| `GET /admin/stripe-webhook-status` | حالة webhook |
| `POST /admin/distribution/confirm-bank` | تأكيد إيصال بنكي |
| `POST /admin/distribution/revert-bank/:id` | التراجع عن إيصال |
| `POST /admin/distribution/confirm-disbursement-batch` | دفعة صرف |
| `POST /admin/distribution/generate-payout` | إنشاء دفعة |
| `POST /admin/distribution/revert-payout/:id` | التراجع عن دفعة |

## `admin` + `super_admin` (وليس admin وحده)

| المسار | ملاحظة |
|--------|--------|
| `GET /admin/users/:id/moderation` | إشراف مستخدم |

## `admin` العادي — مسموح (مع `viewOnly` للـ regulator)

- لوحة التحكم، إدارة الحالات (تحديث حالة/وسائط/تبرعات pending)
- مراقبة المحادثات، إشعارات، تحليلات
- مركز التوزيع (عرض + تصدير Excel — التأكيد المالي لـ super_admin فقط)

## حمايات إضافية

- `viewOnly`: `regulator` — GET فقط على مسارات admin
- `mediaRouteGuard`: `media` — مساران GET + POST محدودان للوسائط
- `protect`: JWT مطلوب لكل `/admin/*`

## تحقق ما قبل الإطلاق

```bash
npm run verify:go-nogo
```

يدقق أن مسارات `super_admin` الحرجة معرّفة في المصفوفة أعلاه وأن عددها يطابق الكود.

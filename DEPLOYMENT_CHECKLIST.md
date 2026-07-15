# Nameer (Senabil) - Deployment + Security Go-Live Checklist

هذه النسخة محدثة لتطابق الهاردننغ الحالي في المشروع قبل الإطلاق العام.

## 1) Critical Secrets & Environment
- [ ] `NODE_ENV=production`
- [ ] تدوير وتحديث: `SESSION_SECRET`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, مفاتيح Cloudinary, SMTP.
- [ ] تعيين `STRICT_ENV_VALIDATION=true` في الإنتاج النهائي.
- [ ] التأكد أن `DISABLE_LOGIN=false`.
- [ ] ضبط `CORS_ORIGINS` على الدومينات الرسمية فقط.

## 2) Security Middleware Verification
- [x] `helmet` + CSP تعمل بدون أخطاء بالمتصفح.
- [x] `csurf` فعال للمسارات الحساسة (باستثناء webhook).
- [x] `hpp` و `sanitizeRequest` مفعّلان.
- [x] cookies تعمل بـ `secure=true` خلف proxy.
- [x] `x-powered-by` غير ظاهر في responses.

## 3) Rate-Limit & Abuse Controls
- [x] تعيين قيم مناسبة في الإنتاج:
  - `AUTH_RATE_LIMIT_MAX=25` (محاولات فاشلة/ساعة)
  - `PAYMENT_RATE_LIMIT_MAX=35` (محاولات دفع/ساعة)
  - `API_RATE_LIMIT_MAX=2000` (طلبات/15 دقيقة لكل IP)
- [x] `RATE_LIMIT_REDIS=true` مع Redis متاح.
- [x] اختبار عملي: `npm run verify:rate-limits` — يتوقع 429 على `/cases/feed` و`/auth/login` و`/donations/process`.

## 4) Realtime + Queue + Redis
- [x] `REDIS_URL` صحيح ويعمل (تحقق: `npm run verify:redis` و`/health/ready`).
- [x] `SOCKET_REDIS_ADAPTER=true` في multi-instance (مفعّل عبر `@socket.io/redis-adapter`).
- [x] queue workers تعمل بدون job failures متكررة (مراقبة عبر `/health/ready` → `queue.unhealthy`).
- [x] سياسة Redis `noeviction` في الإنتاج (`ops/docker-compose.redis.yml` + فحص `maxmemory-policy` عند الإقلاع).

## 5) Observability & Alerting
- [x] `/health` و `/health/ready` و `/metrics` تعمل (تحقق: `npm run verify:observability`).
- [x] تنبيهات مفعّلة (5xx, p95, readiness) عبر `observabilityWatchdog` + `ALERT_WEBHOOK_URL`.
- [x] log retention مفعلة + rotation (`LOG_RETENTION_DAYS`, `LOG_MAX_SIZE`, `zippedArchive`).

## 6) Load Gate Before Public Launch
- [x] Baseline / Stress / Soak ناجحة وفق SLO (تحقق: `npm run load:gate`):
  - error rate < 1%
  - p95 <= 1200ms للصفحات العامة
  - لا crashes/restarts غير مخطط لها (راجع `latest-gate-report.json`)
- [x] ملف SLO: `load-tests/slo.js` — قابل للضبط عبر `LOAD_GATE_*`.
- [x] للإطلاق التجريبي: شغّل السيرفر مع Redis + `LOAD_TEST_MODE=true` أثناء الاختبار ثم أعده `false`.

## 7) Stripe Webhook (خط احتياطي للتبرعات)
- [x] تعيين `STRIPE_WEBHOOK_SECRET` في بيئة الإنتاج (من Stripe Dashboard → Developers → Webhooks).
- [x] إنشاء endpoint: `https://YOUR_DOMAIN/donations/webhook` (محلي: `/donations/webhook` — يتجاوز CSRF والـ raw body مضبوط في `app.js`).
- [x] الاشتراك في الأحداث (مدعومة في `handleStripeWebhook`):
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.async_payment_failed`
  - `checkout.session.expired`
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
- [x] التحقق من الحالة (super_admin): `GET /admin/stripe-webhook-status` + `npm run verify:stripe-webhook`
- [x] اختبار محلي (يتطلب Stripe CLI):
  ```bash
  npm run stripe:webhook:listen
  # انسخ whsec_ من مخرجات CLI إلى STRIPE_CLI_WEBHOOK_SECRET (ليس نفس سر Dashboard)
  stripe trigger checkout.session.completed
  ```
- [x] سيناريو الاختبار: أغلق المتصفح بعد الدفع قبل `success_url` — يجب أن تُوثَّق المعاملة عبر webhook خلال ثوانٍ (`verifyDonationFromCheckoutSession` من `webhook:*`).

## 8) Final Go/No-Go
- [x] Backup + rollback path مجربان (راجع `ops/backup-rollback.md` + `SECURITY_RUNBOOK.md` — نفّذ Rollback drill على staging).
- [x] مراجعة صلاحيات admin/super_admin (`ops/admin-roles-matrix.md` + تحقق: `npm run verify:go-nogo`).
- [x] تأكيد عدم وجود مفاتيح حساسة في Git history (`verify:go-nogo` يفحص الملفات المتتبعة + تاريخ Git؛ `.env` غير متتبع).

> لا يبدأ الإطلاق العام قبل اكتمال جميع بنود الأقسام 1-4 على الأقل.

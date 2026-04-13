# Jussur Sanabel - Deployment + Security Go-Live Checklist

هذه النسخة محدثة لتطابق الهاردننغ الحالي في المشروع قبل الإطلاق العام.

## 1) Critical Secrets & Environment
- [ ] `NODE_ENV=production`
- [ ] تدوير وتحديث: `SESSION_SECRET`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, مفاتيح Cloudinary, SMTP.
- [ ] تعيين `STRICT_ENV_VALIDATION=true` في الإنتاج النهائي.
- [ ] التأكد أن `DISABLE_LOGIN=false`.
- [ ] ضبط `CORS_ORIGINS` على الدومينات الرسمية فقط.

## 2) Security Middleware Verification
- [ ] `helmet` + CSP تعمل بدون أخطاء بالمتصفح.
- [ ] `csurf` فعال للمسارات الحساسة (باستثناء webhook).
- [ ] `hpp` و `sanitizeRequest` مفعّلان.
- [ ] cookies تعمل بـ `secure=true` خلف proxy.
- [ ] `x-powered-by` غير ظاهر في responses.

## 3) Rate-Limit & Abuse Controls
- [ ] تعيين قيم مناسبة في الإنتاج:
  - `AUTH_RATE_LIMIT_MAX`
  - `PAYMENT_RATE_LIMIT_MAX`
  - `API_RATE_LIMIT_MAX`
- [ ] `RATE_LIMIT_REDIS=true` مع Redis متاح.
- [ ] اختبار عملي: بعد تجاوز الحد تظهر 429 على المسارات المقصودة.

## 4) Realtime + Queue + Redis
- [ ] `REDIS_URL` صحيح ويعمل.
- [ ] `SOCKET_REDIS_ADAPTER=true` في multi-instance.
- [ ] queue workers تعمل بدون job failures متكررة.
- [ ] سياسة Redis `noeviction` في الإنتاج.

## 5) Observability & Alerting
- [ ] `/health` و `/health/ready` و `/metrics` تعمل.
- [ ] تنبيهات مفعّلة (5xx, p95, readiness).
- [ ] log retention مفعلة + rotation.

## 6) Load Gate Before Public Launch
- [ ] Baseline / Stress / Soak ناجحة وفق SLO:
  - error rate < 1%
  - p95 <= 1200ms للصفحات العامة
  - لا crashes/restarts غير مخطط لها

## 7) Final Go/No-Go
- [ ] Backup + rollback path مجربان.
- [ ] مراجعة صلاحيات admin/super_admin.
- [ ] تأكيد عدم وجود مفاتيح حساسة في Git history.

> لا يبدأ الإطلاق العام قبل اكتمال جميع بنود الأقسام 1-4 على الأقل.

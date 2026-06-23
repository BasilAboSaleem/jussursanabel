# Backup & Rollback — Jussur Sanabel

## Backup (قبل كل إطلاق)

### MongoDB (مصدر الحقيقة)
1. **Atlas (موصى به):** Dashboard → Cluster → Backup → تأكد أن Cloud Backup مفعّل.
2. **لقطة يدوية قبل الإطلاق:**
   ```bash
   mongodump --uri="$MONGODB_URI" --out=./backups/pre-deploy-$(date +%Y%m%d-%H%M)
   ```
3. احفظ النسخة خارج السيرفر (S3 / تخزين مشفر محلي).

### Redis
- يحمل cache + queue — ليس مصدر الحقيقة للتبرعات.
- لا يلزم backup كامل للإطلاق؛ أعد التشغيل عند الحاجة.

### التطبيق (Render / VPS)
- Render: كل deploy يحتفظ بإصدارات سابقة (Rollback من Dashboard).
- VPS + PM2: احتفظ بـ tag Git لكل إصدار معروف:
  ```bash
  git tag -a v1.0.0-beta -m "pre-beta launch"
  git push origin v1.0.0-beta
  ```

---

## Rollback (خلال ≤ 15 دقيقة)

### Render
1. Dashboard → Service → **Rollback** إلى الإصدار السابق.
2. تحقق:
   - `GET /health` → 200
   - `GET /health/ready` → `ok: true`
   - تسجيل دخول admin
   - `npm run verify:stripe-webhook` (من CI أو محلياً ضد الإنتاج)

### VPS + PM2
```bash
git fetch --tags
git checkout vPREVIOUS_TAG   # أو commit معروف
npm ci --omit=dev
npm run reload:pm2
curl -s -o /dev/null -w "%{http_code}" https://YOUR_DOMAIN/health
```

### MongoDB (استعادة كاملة — حالة طوارئ فقط)
```bash
mongorestore --uri="$MONGODB_URI" --drop ./backups/pre-deploy-YYYYMMDD-HHMM
```
> `--drop` يحذف المجموعات الحالية — استخدم فقط عند فساد بيانات مؤكد.

---

## Rollback drill (تمرين مجرب)

نفّذ مرة واحدة على بيئة staging أو محلياً:

| خطوة | أمر / إجراء | النتيجة المتوقعة |
|------|-------------|------------------|
| 1 | `mongodump` أو تأكيد Atlas backup | ملف backup موجود |
| 2 | نشر إصدار تجريبي ثم rollback (Render أو `git checkout` + `reload:pm2`) | `/health` = 200 |
| 3 | `npm run verify:redis` | Redis OK |
| 4 | `npm run verify:stripe-webhook` | توقيع webhook يعمل |
| 5 | تسجيل دخول super_admin + `/admin/stripe-webhook-status` | `configured: true` |

سجّل التاريخ ومن نفّذ التمرين في سجل الفريق.

---

## مراجع
- `SECURITY_RUNBOOK.md` — إجراءات الحوادث
- `system_rollback_backup.md` — استعادة ملفات قديمة (تطوير فقط)

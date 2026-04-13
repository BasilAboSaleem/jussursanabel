# SECURITY RUNBOOK

## 1) If 5xx spikes suddenly
- Check PM2 status: `npx pm2 ls`
- Check app errors: `npx pm2 logs jussur-sanabel --lines 120 --nostream`
- Check health endpoints:
  - `/health`
  - `/health/ready`
- If recent deployment caused issue: rollback to previous release immediately.

## 2) If Redis is down
- Confirm Redis:
  - Docker: `docker ps`
  - Ping: `docker exec jussur-redis redis-cli ping`
- If unavailable, restart Redis service/container.
- App fallback behavior:
  - page cache falls back to in-memory
  - queue may defer/fail depending on worker state
  - rate limit store falls back to memory (less strict in multi-instance)

## 3) If MongoDB connectivity issues occur
- Verify Atlas/network access rules and DB status.
- Review timeout errors in PM2 logs.
- Temporary mitigation:
  - reduce incoming load using WAF/CDN rules
  - scale down heavy endpoints (homepage/cases limits via env)

## 4) Security incident immediate actions
- Rotate all keys:
  - JWT / SESSION / Stripe / Cloudinary / SMTP
- Invalidate active sessions if compromise suspected.
- Enable `STRICT_ENV_VALIDATION=true` in production.
- Increase auth/payment limiter strictness temporarily.

## 5) Rollback procedure
- Keep previous known-good deployment version.
- Rollback app.
- Verify:
  - `/health` = 200
  - login works
  - donation webhook path still reachable and verified


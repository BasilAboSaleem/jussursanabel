# Nameer (نَمير) — Direct Giving Platform

**Nameer** is a bilingual (Arabic/English) web platform operated under **Senabil Youth & Development Foundation** (مؤسسة السنابل للشباب والتنمية). It connects donors directly with verified orphan and family cases in Gaza through a transparent, dignity-preserving workflow: field verification, media review, secure payments, real-time communication, and full audit trails.

**Production (beta):** [https://jussursanabel-beta.onrender.com](https://jussursanabel-beta.onrender.com)

---

## Table of Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Feature Map](#feature-map)
- [User Roles](#user-roles)
- [Case Lifecycle](#case-lifecycle)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Development](#local-development)
- [Environment Variables](#environment-variables)
- [NPM Scripts](#npm-scripts)
- [Deployment](#deployment)
- [Security](#security)
- [Internationalization](#internationalization)
- [Real-Time & Background Jobs](#real-time--background-jobs)
- [Payments (Stripe)](#payments-stripe)
- [Observability & Health](#observability--health)
- [Load Testing](#load-testing)
- [Mobile (Capacitor)](#mobile-capacitor)
- [Seeding & Test Data](#seeding--test-data)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Nameer is a full-stack **Node.js / Express** application with **server-rendered EJS views**, **MongoDB** persistence, optional **Redis** for caching, rate limiting, Socket.IO scaling, and email queues, and **Stripe** for donations. The platform serves:

- **Public visitors** — browse cases, watch story reels, donate, read transparency content
- **Donors** — sponsor cases, follow updates, message families (after approval), join teams
- **Beneficiaries / guardians** — register cases, submit proof of impact, receive payouts
- **Staff** — multi-role admin console for verification, media editing, finance, support, and compliance

The codebase package name is `subul-platform` (historical); the product brand is **Nameer**.

---

## Core Principles

| Principle | Implementation |
|-----------|----------------|
| **Direct connection** | Donors fund specific cases; disbursement tracks to guardians |
| **Verification** | Multi-stage case approval before public listing |
| **Privacy & dignity** | Family structure hidden from public; moderated messaging |
| **Transparency** | Ledgers, fees, impact proofs, activity logs (role-gated) |
| **Content safety** | Forbidden-word filter; optional copy-from-example detection |
| **Bilingual UX** | Arabic (default, RTL) and English (LTR) |

---

## Feature Map

### Public website

- Homepage with impact stats, urgent cases carousel, vision section, testimonials
- Case listing with filters (orphan / family), pagination, funding progress
- Case detail pages: story, gallery, impact metrics, follow, team donations, chat request
- **Stories hub** (`/stories`) — vertical video feed (YouTube / Cloudinary / direct MP4)
- About, contact, transparency pages
- Language switcher (`/lang/ar`, `/lang/en`)

### Authentication & profiles

- Registration flows for donors and beneficiaries (Palestinian ID + IBAN validation)
- JWT + session cookies, password reset via email
- Profile management, payment details (IBAN for guardians)
- Beneficiary approval gate before case registration

### Case management

- Beneficiary case registration with family structure, needs, photos, optional story video
- Registration guide and story templates (admin-configurable)
- Anti-copy validation for example stories (configurable via `ENABLE_STORY_COPY_CHECK`)
- Admin case manager with status workflow, field reports (PDF), visibility toggles

### Media review

- Dedicated **media review** screen for `media` and `super_admin` roles
- Edit title, short description, long story (`details.storyAr`), video URL, images
- Atomic JSON save with post-write DB verification
- Publish / reject from `media_review` → `approved` / `rejected`
- Super admins can edit approved cases; changes invalidate public page cache

### Donations & finance

- Stripe Checkout (one-time and sponsorship flows)
- Webhook handling for payment confirmation
- Transaction ledger, operation fees, bank receipt confirmation
- Distribution center: payout generation, batch disbursement, Excel exports
- Donation teams (group fundraising per case)

### Communication

- **Messages hub** — donor ↔ family messaging after chat approval
- Chat request workflow (pending / approved / rejected)
- Admin chat monitoring and moderation
- Support tickets (`/support/chat`)
- Real-time notifications via Socket.IO

### Administration

- Role-based dashboards (admin, super_admin, regulator, media, support)
- User management, escalations center, activity logs
- System settings (case registration content, forbidden words, story examples)
- Impact proof approvals, notification broadcasts
- Analytics, Stripe webhook status, password recovery tools

---

## User Roles

| Role | Purpose |
|------|---------|
| `donor` | Browse, donate, follow cases, message approved families |
| `beneficiary` / `family` / `guardian` | Register and manage own cases |
| `admin` | Case verification, user ops (limited media-stage rules) |
| `super_admin` | Full platform control, settings, finance, hard deletes |
| `media` | Media review: edit content, publish/reject from `media_review` |
| `regulator` | Read-only oversight + escalation submissions |
| `support` | User assistance, chat requests, escalations |

---

## Case Lifecycle

```
pending → field_verification → media_review → approved → completed / fully_sponsored
                                      ↘ rejected
```

| Status | Meaning |
|--------|---------|
| `pending` | Submitted by guardian, awaiting review |
| `field_verification` | Field team validating facts on the ground |
| `media_review` | Editorial pass: title, description, story, media |
| `approved` | Public listing live |
| `rejected` | Not published (reason recorded) |
| `completed` / `fully_sponsored` | Funding goal met or case closed |

**Content fields:**

- `title` — headline on case pages and cards
- `description` — short text on listing cards and stories feed
- `details.storyAr` — long narrative on case detail page
- `storyVideo` — optional reel linked from case hero and `/stories`

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js ≥ 18 |
| Framework | Express 5 |
| Views | EJS |
| Database | MongoDB (Mongoose 9) |
| Cache / queues | Redis, BullMQ, ioredis |
| Real-time | Socket.IO + Redis adapter |
| Payments | Stripe |
| Media | Cloudinary, Multer (local `/uploads` fallback) |
| Auth | JWT, bcrypt, express-session (Mongo store) |
| Security | Helmet, CSRF, HPP, rate limiting, input sanitization |
| i18n | i18n (ar/en) |
| Process manager | PM2 (production cluster) |
| Mobile shell | Capacitor (Android/iOS) |
| Monitoring | Prometheus metrics (`/metrics`), Winston logs, alert webhooks |

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Browser   │────▶│ Express app  │────▶│   MongoDB   │
│  (EJS/JS)   │◀────│  (app.js)    │◀────│             │
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐  ┌──────────┐  ┌─────────┐
         │ Redis  │  │ Socket.IO│  │ Stripe  │
         │ cache  │  │ adapter  │  │ webhooks│
         │ queue  │  └──────────┘  └─────────┘
         └────────┘
```

- **Early page cache** — anonymous GET requests for `/`, `/cases`, `/stories` (Redis + in-memory; bypassed when logged in)
- **Cache invalidation** — case content updates purge case detail, listing, homepage, and stories keys across PM2 instances
- **CSRF** — global protection; multipart routes defer validation until after Multer
- **Stripe webhook** — raw body route mounted before JSON parsers

---

## Project Structure

```
subul/
├── server.js              # HTTP server, Socket.IO, infrastructure bootstrap
├── app.js                 # Express app, middleware, routes
├── app/
│   ├── controllers/       # Route handlers
│   ├── models/            # Mongoose schemas
│   ├── routes/            # Express routers
│   ├── middlewares/       # auth, cache, CSRF, rate limits, sanitization
│   ├── utils/             # email, stripe, redis, queue, validators, etc.
│   └── config/            # security (Helmet, cookies)
├── views/
│   ├── pages/             # EJS page templates
│   └── partials/          # layout, header, admin chrome
├── public/
│   └── assets/            # CSS (premium.css), JS, images
├── locales/               # ar.json, en.json
├── scripts/               # verification & ops helpers
├── load-tests/            # k6, Artillery configs
├── render.yaml            # Render.com blueprint
├── ecosystem.config.js    # PM2 cluster config
├── seed.js                # Admin seed
└── seed-family.js         # Local test beneficiary + case
```

---

## Prerequisites

- **Node.js** 18 or newer
- **MongoDB** (local or Atlas)
- **Redis** (required for production: sockets, queues, distributed rate limits)
- **Stripe** account (test or live keys)
- **Cloudinary** (recommended for story videos on mobile)
- **SMTP** (required in production for password reset and receipts)

---

## Local Development

### 1. Clone and install

```bash
git clone https://github.com/BasilAboSaleem/jussursanabel.git
cd jussursanabel
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set MONGODB_URI, JWT_SECRET, SESSION_SECRET
```

### 3. Seed an admin (optional)

```bash
node seed.js
```

### 4. Seed a test family (optional, local only)

```bash
node seed-family.js
# Remove with: node seed-family.js --remove
```

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Stripe webhooks (local)

```bash
npm run stripe:webhook:listen
# Set STRIPE_CLI_WEBHOOK_SECRET in .env from CLI output
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full list. Critical variables:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `BASE_URL` | Public site URL (Stripe redirects, emails, OG tags) |
| `JWT_SECRET` / `SESSION_SECRET` | Auth secrets (required in production) |
| `REDIS_URL` | Redis connection (production) |
| `STRIPE_*` | Stripe keys and webhook secret |
| `CLOUDINARY_*` | Media hosting (story videos) |
| `EMAIL_*` | SMTP for transactional email |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `ENABLE_STORY_COPY_CHECK` | `true` to block stories copied from registration examples |

Production boot validates required secrets via `app/utils/envGuard.js` when `STRICT_ENV_VALIDATION=true`.

---

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Production entry (`node server.js`) |
| `npm run dev` | Nodemon development server |
| `npm run start:pm2` | PM2 cluster (production) |
| `npm run reload:pm2` | Zero-downtime PM2 reload |
| `npm run verify:redis` | Redis connectivity check |
| `npm run verify:stripe-webhook` | Stripe webhook endpoint test |
| `npm run verify:go-nogo` | Pre-deploy readiness gate |
| `npm run load:k6` | k6 smoke load test |
| `npm run cap:sync` | Sync Capacitor Android project |

---

## Deployment

### Render.com

The repo includes [`render.yaml`](render.yaml) defining:

- **Web service** — Node, PM2 cluster, health check at `/health`
- **Redis** — attached via `REDIS_URL`

After deploy, set in Render dashboard:

1. `BASE_URL` → your service URL or custom domain
2. `MONGODB_URI`, Stripe, Cloudinary, email credentials
3. Update Stripe webhook endpoint to `https://YOUR_DOMAIN/donations/webhook`

### PM2 (VPS / container)

```bash
npm run start:pm2
npm run reload:pm2   # after code updates
```

`ecosystem.config.js` runs `instances: max` in cluster mode with memory restart at 600MB (configurable).

### Custom domain

Add domain in Render → **Settings → Custom Domains**, update DNS, then set `BASE_URL` and `CORS_ORIGINS`.

---

## Security

- **Helmet** — CSP and security headers (`app/config/security.js`)
- **CSRF** — cookie-based tokens on all mutating routes
- **Rate limiting** — auth, payment, and API tiers (Redis-backed in production)
- **HPP + sanitization** — HTTP parameter pollution and null-byte stripping
- **Role middleware** — `protect`, `restrictTo`, `mediaRouteGuard`, `viewOnly` (regulator)
- **Family structure** — visible only to platform staff and case owner
- **Content filter** — mandatory forbidden words + admin-extensible list
- **Metrics** — `/metrics` protected by IP allowlist and/or basic auth

---

## Internationalization

- Locales: `locales/ar.json`, `locales/en.json`
- Default: Arabic (`rtl`)
- Cookie: `lang` (`ar` | `en`)
- Templates use `__('key')` helper

---

## Real-Time & Background Jobs

- **Socket.IO** — notifications, chat; Redis adapter for multi-instance
- **BullMQ** — email queue when Redis is available; direct SMTP fallback otherwise
- **Page cache pub/sub** — invalidates in-memory cache on all nodes after case updates

---

## Payments (Stripe)

Flow:

1. Donor selects amount on case checkout
2. Redirect to Stripe Checkout
3. Webhook confirms payment → updates `Transaction` and case `raisedAmount`
4. Super admin manages distribution / bank receipts in admin console

Test mode: set `STRIPE_MODE=test` and use test keys.

---

## Observability & Health

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness (200 OK) |
| `GET /health/ready` | Readiness: MongoDB, Redis, queue, socket adapter |
| `GET /metrics` | Prometheus metrics (protected) |

Logs rotate daily under `logs/` (Winston). Optional `ALERT_WEBHOOK_URL` for 5xx rate and latency alerts.

---

## Load Testing

```bash
# Start server with LOAD_TEST_MODE if needed
npm run load:k6
npm run load:artillery
npm run load:gate    # SLO gate script
```

Configs live in `load-tests/`.

---

## Mobile (Capacitor)

Android/iOS shells load the web app from `CAPACITOR_SERVER_URL`:

- Emulator: `http://10.0.2.2:3000`
- Device on LAN: `http://<your-ip>:3000`
- Production: your HTTPS `BASE_URL`

```bash
npm run cap:sync
npm run cap:open:android
```

---

## Seeding & Test Data

| File | Purpose |
|------|---------|
| `seed.js` | Creates default admin user |
| `seed-family.js` | Local beneficiary + case for QA (not for production) |

Never commit `.env` or real credentials.

---

## Contributing

1. Branch from `main`
2. Follow existing patterns (`nm-admin-*` admin UI, `premium.css` public UI)
3. Run verification scripts before deploy
4. Keep commits focused; use conventional prefixes (`feat`, `fix`, `docs`)

---

## License

ISC — Proprietary software of **Senabil Youth & Development Foundation**.  
All rights reserved unless otherwise agreed in writing.

---

## Affiliation

**Nameer (نَمير)** — A platform by [Senabil Youth & Development Foundation](https://senabilcharity.org)  
Contact: pal-gaza@senabilcharity.org

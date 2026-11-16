# NEXSUB Store — rebuild/nexsub-features

## Scope
- Pinned versioned catalog: `catalog.v2026-11-17.js`, shared by client and server in each deployment.
- 17 verified MicroeSIM ASIA+EU 52 variants (3 one-day GB; 14 unlimited durations). Server validates product, variant, published price/duration and pinned provider plan ID.
- Legacy `catalog.js`, 500 MB route, prior catalog pricing, existing order links, and confirmed legacy mapping in `MICROESIM_PLAN_MAP` retained.
- Only Netflix and OSN+ subscription products submit through the order API; remaining subscription cards display plain **اطلب عبر واتساب** with no click action. Unpriced country products are marked unavailable for direct order.
- eSIM sender WhatsApp and transfer receipt required. Emailed receipts are not introduced. Subscription receipt label has no **اختياري**, but subscription upload remains optional.
- Existing Telegram review, MicroeSIM signature and issuance lifecycle retained. A failed or uncertain Telegram send is not automatically retried to avoid duplicate admin notifications; manual review is required.
- Customer data usage is shown on a ready order page and via the site navigation usage form. `topupDetail` obtains device IDs; `deviceDetail` obtains usage for each eSIM. QR images are decoded locally. Only an on-site order URL with its UUID access key, or an exact full LPA match, authorizes inquiry.
- `data_usage` and optional `data_usage_daily`, `is_daily`, `daily_reset_time` are read. Unit-less values are assumed **MB**, with **1000 MB = 1 GB**. Zero is meaningful. No unverified speed throttling, remaining allowance or expiry is shown.
- The monthly unique browser count uses a random Secure HttpOnly cookie hashed with server-held secret and the current **Asia/Muscat** calendar month. Clearing cookies or using another browser starts a new count.
- Only the Telegram private administrator (matching `TELEGRAM_CHAT_ID`) may query **زوار الشهر**. Send `/start` to reveal the button.

## Files
- Modified `_worker.js`, `index.html`
- Added `catalog.v2026-11-17.js`, `usage-main.js`, `usage-tracking.js`, `migrations/0001_monthly_visitors.sql`, `tests/nexsub.test.mjs`, CI workflow, `.gitignore`, `.dev.vars.example`.

## Data and rollout
- Verified production D1 already has `monthly_visitors`. Applied non-destructive migration to PREVIEW D1 only on 2026-11-17; preview orders were preserved.
- Cloudflare Pages `nexsubstore` currently uses ad-hoc deployment, not automatic GitHub builds. A branch preview still needs its own manual Cloudflare Pages upload. Production must not be redeployed before review.
- Cloudflare Pages preview binding: `ORDERS_DB` => `nexsub-orders-preview`; production binding: `ORDERS_DB` => `nexsub-orders-production`.
- Keep all secrets in Cloudflare environment variables (including provider credentials, Telegram credentials and recommended `VISITOR_HASH_SECRET`). Do not use live tokens for tests.

## Tests and limitations
- `node --test tests/nexsub.test.mjs` contains provider-mocked tests; it does **not** make real purchases or send real Telegram messages.
- The tests include 17 catalog mappings, data usage 0 MB and 1000 MB conversion, ready link and LPA, invalid credentials, pending orders, provider failure, subscription restrictions, sender phone and receipt, unique visits and admin gate.
- GitHub Actions workflow `NEXSUB checks` runs on pull requests and branch updates when permitted.
- **Not live-tested:** actual MicroeSIM payloads/signature, real Telegram delivery, real Cloudflare preview browser/mobile, and QR scanning on actual iOS/Android devices. Provider confirmation of speed policy, optional remaining allowance and expiration fields is still required.
- jsQR 1.4.0 is loaded from pinned CDN fallback; native BarcodeDetector is preferred. Decode stays in browser but CDN availability should be verified for target mobile browsers.
- Existing public support/payment numbers and image files should be reviewed to ensure they are intentionally public. The repository has no committed customer orders or database copies in the inspected original tree.

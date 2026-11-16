# Live production parity audit — NEXSUB Store

Date: 2026-11-17 (Africa/Cairo)
Audited release: `https://nexsubstore.com`, Cloudflare Pages project `nexsubstore` in account `6bfd3ec609a0b232f3782232b689d7d4`.
Current production deployment ID: `fb1173fb-465a-424c-b088-7a753434e4b8`.
Backup branch: [backup/production-live-2026-11-17](https://github.com/mohammedmas3oud00-ux/nexsubstore/tree/backup/production-live-2026-11-17/production-live-2026-11-17).

## Discovery — production differs from GitHub main
The public production deployment was Direct Uploaded, not built from the current `main` files. The live assets were fetched over HTTPS using Cloudflare Browser Rendering, and the 10 deployed public assets were preserved in the backup branch.

| Live production feature / file | What existed | How the rebuild preserves it |
| --- | --- | --- |
| `index.html` | Arabic RTL storefront, GSAP/Lenis effects, filter/search/cart-like product modal, calculator, FAQ, legal sections | Rebuild `index.html` was reconstructed **from the actual live production HTML**, with only requested incremental changes |
| `catalog-20261116.js` | 30 products, all current variant prices and durations, 17 specified ASIA+EU 52 variants, legacy 500 MB and Turkey country products | Old asset retained unchanged for cached clients; `catalog.v2026-11-17.js` matches **all 30 product records and attributes** (including `checkout: site` for Netflix and OSN+). Browser and Worker both use the new pinned version |
| Netflix and OSN+ | `checkout: site`; existing prices/durations; order via site | Retained, backend only accepts these subscriptions |
| Other nine subscriptions | Visually nonclickable `sp-static` cards, with prices and “اطلب عبر واتساب” as text | Exact live static-card behavior retained, and server rejects direct API checkout |
| Unpriced country cards | Static card, “السعر عند الطلب” | Preserved static behavior, explicitly labeled “غير متاح للطلب المباشر” |
| `order-usage.js` | Ready-order consumption button calls legacy `GET /order/:uuid/:access/usage` and renders cumulative, per-day entries and reset time | Unchanged JS asset retained. Worker route restored with old response shape and fresh provider requests |
| `visitors.js` | Browser UUID stored in `localStorage`, `POST /api/visit` | Exact live script retained; legacy API route added using monthly Muscat time and hashed UUID. New HttpOnly-cookie `/api/visitor` remains available for future clients |
| `qr-display.js` / `qrcode-generator.js` | Local QR rendering for issued eSIM on order page | Byte-identical live assets copied into backup, kept in rebuild deployment |
| `tracking-link.js` | Copyable existing tracking links | Preserved unchanged and original route/matching keys retained |
| `img/logo.png`, `img/hero-bg.jpg` | Published visual identity | Source blobs were cross-verified with the two production/preview asset manifests and copied into backup |
| `_worker.js` (private Pages Functions module) | Cloudflare-provisioned logic; known external behavior for availability, order tracking, eSIM issuance, Telegram, usage, visitor count | Its actual deployed bytes **could not be downloaded** through the available Pages API. Rebuild retains the original main Worker implementation, and adds the verified exposed legacy routes. **Complete behavioral parity of unpublished Worker internals is not independently proven.** |

## Additional improvements retained from rebuilding
- 17 pinned MicroeSIM mapping UUIDs validated against exact durations and prices on the server.
- Transfer-sender WhatsApp and upload receipt mandatory for eSIMs; subscriptions retain their current receipt-upload policy.
- Existing live (cached) forms sending `whatsapp` instead of `transfer_whatsapp`, and lacking `catalog_version`, still work after server-side validation.
- Homepage usage form allows pasted tracking link or locally decoded eSIM QR image, without fetching QR URLs.
- `POST /api/usage` uses `topupDetail` then `deviceDetail`, including data usage, optional daily series and reset times. Unit-less data uses MB; 1000 MB = 1 GB, and 0 is valid.
- Old `GET /order/:uuid/:access/usage` and `POST /api/visit` are retained for backward compatibility with cached clients.
- Current monthly visitor aggregate is preserved. Changing hashing from the previous unpublished server implementation could cause a previously counted browser to be counted again during the transition month; investigate the original server hash before promising exact month-to-date continuity.
- At-most-once order notifications and approval/issuance CAS checks; manual reconciliation needed for uncertain notification failures.
- The advertised speed-throttling figure for 500 MB was removed pending provider confirmation.

## Validation
- **30/30 products** exact deep equality of every catalog attribute, not only pricing.
- **12/12 static parity checks**: UI sections, existing JS effects, static cards, old visitor path, current Netflix/OSN flags, new usage form, sender phone, versioned catalog and no unsupported speed claim.
- **17/17 mocked Node integration tests** passed in GitHub Actions: catalog mapping, usage 0 MB/GB and dates, LPA/links, rejected/non-ready/provider failure, eSIM validation, Netflix/OSN, unique monthly visitors, legacy visitor/usage routes, sender form compatibility/idempotence and duplicate approval. No real charge, actual eSIM issue, or real Telegram messages.
- GitHub Actions secret-pattern scan and clean Pages artifact packaging passed.
- Existing Cloudflare **production** Worker code is inaccessible for source diff, so do not call this a fully restored production backup.
- Browser/mobile visual QA and real provider/Telegram end-to-end behavior still unverified on this merged code.

## Database and rollback
- Original production D1 binding: `ORDERS_DB` => `3d30bc46-ff33-46c8-9fa9-7e4e4cfebc25`; existing orders and visitor tables remain unchanged. No customer D1 data is checked into the **public** repository.
- Restore point: Cloudflare production deployment `fb1173fb-465a-424c-b088-7a753434e4b8`. Preserve until the replacement is verified; this is operational rollback, not a complete GitHub recovery of the private Worker.

## Why production deployment remains blocked
1. Original production Worker source is not available to compare/recover exactly; replacing it could remove undocumented live capabilities.
2. Connected Cloudflare Pages asset upload returns HTTP 403 `Authorization failed` for the required Direct Upload asset workflow. The updated `index.html`, versioned catalog and new scripts are not all available in the original account's asset store.
3. Any deploy without uploading those assets would cause a Worker/browser catalog mismatch and could stop live orders. **Never deploy a Worker-only change with the old manifest.**
4. Full browser/mobile and provider integration smoke tests have not yet been run on the merged code in the original account's preview environment.

**Production deployment status: NOT PERFORMED.** Keep the PR in Draft until deployment has both proper asset upload authorization and a verified rollback/full Worker backup or an accepted, tested replacement.

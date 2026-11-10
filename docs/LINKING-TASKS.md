# Yard — what's left to connect (for the owner)

Branch: work from `v3`. Before you start each task:

```bash
git checkout v3 && git pull origin v3 && git checkout -b link/<task-name>
```

When a task is done, push the branch (`git push -u origin link/<task-name>`) and tell Claude.
Claude reviews it, fixes what's wrong, runs every test kit and the browser journeys, and merges it into `v3`.
Never push straight to `main`, and never force-push.

## Rules that would have prevented most of the last review's bugs

1. **Money is always minor units** (kobo/cents) end to end. Never divide or multiply by 100 yourself — use `formatMoney` / `<Price>` from `src/lib/money.ts`.
2. **When you move a page from sample data to the server, find every other reader of that sample data** (bag, delivery quotes, counts, rails, filters) and move it too. `grep` for the sample import (`@/lib/data/...`, `variantById`, `products`) after you finish.
3. **Show the server's error message.** Use `ApiError` (`src/lib/api/client.ts`) and `fields` for per-field errors. Never replace errors with "check your connection".
   - `409` → offer "Reload" with the server copy.
   - `403` with `fields.reauth === "required"` → ask for the password (admins: authenticator code), `POST /api/auth/reauth`, then retry.
   - `429` → "Too many tries, wait a moment".
4. **Every change that creates money or a record sends an `Idempotency-Key`** (a fresh key per user action, reused on retry).
5. **Real accounts' data never goes in localStorage.** Read it from the server; only demo/sample data may be stored locally. Clear anything account-specific on sign-out.
6. **Gate by role in the UI the same way the server does** (owner/admin/finance), so people don't get 403 loops.
7. **Loading, empty and error states on every new screen**, with a Retry on error. Check phone widths 390 and 320 (no sideways scroll; use `grid-cols-[minmax(0,1fr)]`).
8. **Follow the existing UI patterns** (trays and inline forms, existing tables, `StatusBadge`, skeletons). Don't add new modals for entering values.
9. Run before pushing: `npx tsc --noEmit` and `npx eslint <changed files>`.

## The tasks (in recommended order)

### 1. Admin — brand applications and product hiding (small, high value)
- Page: `src/app/admin/brands/page.tsx` (+ components in `src/components/admin/marketplace/`), `src/app/admin/products/page.tsx`.
- API:
  - `GET /api/admin/catalog/onboardings` — queue of submitted applications.
  - `POST /api/admin/catalog/onboardings/{id}/review` — approve / reject with a reason.
  - `POST /api/admin/catalog/products/{id}/moderation` — hide / unhide a product with a reason.
- Watch out: approval must not undo a suspension; show the server's message if it refuses.
- Done when: an application submitted from Studio onboarding appears, approving it lets the brand open Studio, hiding a product removes it from `/shop`.

### 2. Admin — finance and payouts (biggest money screen)
- Page: `src/app/admin/finance/page.tsx`, components in `src/components/admin/finance/*` (currently sample data: `finance-view.tsx`, `payouts-tab.tsx`, `reconciliation-tab.tsx`, `adjustments-tab.tsx`, `transactions-tab.tsx`, `commission-tab.tsx`).
- API:
  - `GET /api/admin/finance/overview`
  - `GET /api/admin/finance/payouts`, `GET /api/admin/finance/payouts/{id}`
  - `POST /api/admin/finance/payouts/{id}/approve` / `.../reject` — **two different admins**, each needs recent reauth (403 `reauth` → authenticator code → retry). An admin who belongs to the brand is refused.
  - `GET/POST /api/admin/finance/batches`, `GET /api/admin/finance/batches/{id}`, `POST /api/admin/finance/batches/{id}/run` (safe to run twice)
  - `GET /api/admin/finance/ledger`, `POST /api/admin/finance/adjustments` (reauth, reason required)
  - `GET/PUT /api/admin/finance/brands/{brandId}` — tier, commission override, payout hold
  - `GET/POST /api/admin/finance/reconciliation`, `GET .../reconciliation/{id}`, `POST .../reconciliation/items/{id}/resolve`
- Watch out: amounts are minor units; show who approved first; disable the second approval for the same admin.

### 3. Admin — orders, refunds, disputes, Paystack log
- Page: `src/app/admin/orders/page.tsx`, `src/components/admin/finance/orders-view.tsx`, `order-detail.tsx`, `refunds-tab.tsx`, `disputes-tab.tsx`.
- API:
  - `GET /api/orders/admin/{id}`
  - `POST /api/orders/admin/{id}/refunds` — reauth, idempotency key, can't exceed what was paid (422 shows why)
  - `POST /api/orders/admin/{id}/returns/{returnId}/decision`
  - `GET /api/orders/admin/disputes`, `PATCH /api/orders/admin/disputes/{id}`
  - `GET /api/webhooks/paystack/events`, `GET .../events/{id}`, `POST .../events/{id}/replay` (owner/engineering/finance only)
- Nice to have after: a "customer money" panel on the admin Users page (orders, payments, refunds per user).

### 4. Studio — onboarding on the server
- Components: `src/components/studio/onboarding/*` (`wizard.tsx`, `store.ts`, `steps/*`) — today saved in the browser.
- API: `GET /api/studio/onboarding`, `PUT /api/studio/onboarding/steps/{step}` (send `revision`; 409 → reload), `GET /api/studio/onboarding/handle?handle=` (availability), `POST /api/studio/onboarding/submit`.
- Watch out: bank details are NOT saved here (only bank name + last 4); full details go through Studio Settings → payout account after approval.
- Done when: start onboarding on one device and continue on another; submitted application shows in admin (task 1).

### 5. Studio — storefront editor
- Components: `src/components/studio/storefront-editor/*`, page `src/app/studio/(workspace)/storefront/page.tsx`.
- API: `GET /api/studio/storefront`, `PUT /api/studio/storefront/draft` (send `revision`), `POST /api/studio/storefront/publish` (send live `version`), `GET /api/studio/storefront/versions/{version}`, `POST .../versions/{version}/restore`.
- Public read already exists: `GET /api/catalog/storefronts/{handle}` — switch the public brand page to it.

### 6. Studio — collections (finish)
- `src/components/studio/catalog/collections-view.tsx`, `collection-dialog.tsx`.
- API: `GET/POST /api/studio/catalog/collections`, `PATCH/DELETE .../{id}`, `PUT .../{id}/products`.

### 7. Drops and draws (shopper + Studio)
- Shopper: `src/app/(market)/drops/*`, `src/components/market/drop-card.tsx`, `notify-button.tsx`, `use-drop-add-block.ts`.
- Studio: `src/app/studio/(workspace)/drops/*`.
- API: `GET /api/drops`, `GET /api/drops/{id}` (includes `me.canBuy`, `me.reason`, `me.entry`), `POST/DELETE /api/drops/{id}/reminder`, `POST/DELETE /api/drops/{id}/entry`, `GET /api/drops/me`, `GET /api/drops/{id}/draw` (public fairness info); Studio: `GET /api/drops/studio`, `POST /api/drops`, `PATCH /api/drops/{id}` (send `expectedVersion`), `POST/DELETE /api/drops/{id}/schedule`, `POST /api/drops/{id}/cancel`, `POST /api/drops/{id}/draw`.
- Watch out: purchase limits are enforced by checkout on the server — show `me.reason`, don't re-implement the rule.

### 8. Search
- `src/components/market/search-overlay.tsx`, `src/components/market/catalog/catalog-search.tsx`.
- API: `GET /api/search?q=&category=&brand=&min=&max=&currency=` (facets + prices in the shopper's currency), `GET /api/search/suggest?q=`.

### 9. Alerts and unsubscribe
- Back in stock: `POST /api/wishlist/back-in-stock` `{ variantId }`, `DELETE /api/wishlist/back-in-stock/{variantId}` — add a "Notify me" on sold-out sizes on the product page.
- Unsubscribe page (new): `src/app/(market)/unsubscribe/page.tsx` — reads `?token=`, `GET /api/notifications/preferences/unsubscribe?token=` to show what it will do, then a button that `POST`s to the same URL. No sign-in needed. Remove the token from the URL after.

### 10. Small bugs (Claude will do these unless you want them)
- `/following` overflows at 320px.
- `recentlyViewed` in `src/lib/stores/saved.ts` survives sign-out — clear it with the account's other saves.
- Studio sidebar payout card says "Request payout" during the 24h cooldown — use the same `blockedReason` as the Payouts page.
- One-off script to give brands approved before the fix a starter shipping profile and shorten long onboarding SKUs.

## Not code — owner's checklist
- Paystack: live keys, webhook URL `https://<domain>/api/webhooks/paystack`, verify Nigerian bank codes in `src/components/studio/business/settings-model.ts` (`bankCodeFor`) against Paystack's bank list.
- Email: Resend or Postmark, sending domain DNS (SPF/DKIM/DMARC); env `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM`, `YARD_SUPPORT_EMAIL`, `YARD_BUSINESS_ADDRESS`.
- Google/Apple sign-in keys (optional for launch).
- `YARD_PUBLIC_URL`, `YARD_ENCRYPTION_KEY` (keep a safe copy — losing it loses stored bank details).
- Legal pages: terms, privacy, refunds, seller agreement.
- Hosting: confirm with Pxxl — always-on Node process, single instance, Postgres backups + region. Claude prepares the hosted-Postgres + R2 switch and a deploy guide.
- First admin on production: `npm run admin:create -- --email you@… --name … --role owner`.

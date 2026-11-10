# Yard — remaining linking tasks, round 2 (for the owner)

These are the parts of `docs/LINKING-TASKS.md` that are still not done after commit `bf8fb97`.
The bugs found in `bf8fb97` itself are being fixed by Claude on the review branch and will be merged into `v3`
before you start — **pull `v3` first** so you build on the fixed code:

```bash
git checkout v3 && git pull origin v3 && git checkout -b link/<task-name>
```

One branch per task. When a task is done: `git push -u origin link/<task-name>` and tell Claude.
Never push straight to `main`, never force-push.

## Rules (same as round 1 — the last two reviews broke these most)

1. **Money is minor units everywhere** (kobo/cents). Never `/100` or `*100` by hand. Show money with `formatMoney`/`<Price>`;
   when an admin or brand *types* an amount, accept major units (₦12,500) and convert once with the helpers in `src/lib/money.ts`.
2. **Switching a screen to the server means switching every reader of the old sample data** — counts, badges, detail sheets,
   palettes, filters, search. After you finish, grep for `@/lib/data/`, `useAdmin(`, `useStudio(` in the files you touched.
3. **Show the server's error message** (`ApiError.message`, `ApiError.fields`). `409` → "Reload". `403` with
   `fields.reauth === "required"` → ask for password/authenticator code, `POST /api/auth/reauth`, retry — and never reuse a code once used.
4. **Idempotency-Key** on anything that creates money or a record (one fresh key per user action, reused on retry).
5. **No real-account data in localStorage.** Clear account data on sign-out.
6. **Gate by role in the UI exactly like the server does**, so people don't get 403 loops or buttons that can't work.
7. **Every list that can grow needs paging** ("Load more"/cursor) — never a silent cap at 50/100/200.
8. **No `window.prompt` / `confirm` / new modals for typed values** — use the tray + inline composer pattern (see AGENTS-style rules in the repo).
9. Loading, empty and error (with Retry) states; no sideways scroll at 390 and 320 (`grid-cols-[minmax(0,1fr)]`, `min-w-0`, `break-words`).
10. Before pushing: `npx tsc --noEmit` and `npx eslint <changed files>`.

---

## A. Studio onboarding — finish task 4 (do this first: it blocks real brands)

### A1. Real sign-up in the onboarding account step
- File: `src/components/studio/onboarding/steps/account.tsx` (uses `useDemoSignIn()` at lines ~24, 42, 64 and says "Demo build: there are no real accounts").
- Use the real auth routes: `POST /api/auth/sign-up` (then the verify-email flow), `POST /api/auth/sign-in`, Google/Apple via
  `GET /api/auth/oauth/{google|apple}/start?mode=sign-in&next=/studio/onboarding` (hide buttons when `GET /api/auth/providers` says off).
  Handle the response statuses `signed_in`, `verify_email` (show "check your inbox" + resend), `mfa_required`.
- Keep demo sign-in **only** when the session is a demo session / demo build.
- Done when: a brand-new person signs up from `/studio/onboarding`, verifies email, continues the wizard, submits — with no demo account involved.

### A2. Show Yard's review note to a rejected applicant
- Server already returns `reviewNote` when status is `rejected` (`src/server/catalog/onboarding.ts` ~line 80).
- File: `src/components/studio/onboarding/store.ts` / `wizard.tsx` / `top-bar.tsx`: show a clear banner "Yard asked for changes: <note>"
  on every step until they resubmit; it must not disappear after their first edit (keep it from the server copy, not local state).
- Done when: admin rejects with a note → applicant sees the note → edits → still sees it → resubmits → note gone.

## B. Admin — finish task 3

### B1. Disputes fully wired
- File: `src/components/admin/finance/orders-live-view.tsx` (disputes part).
- API: `GET /api/orders/admin/disputes`, `PATCH /api/orders/admin/disputes/{id}` (status + internal note; allow clearing the note).
- Add: status controls (open → evidence requested → response submitted → won/lost as the server allows), a link to the order, the brands' evidence.
- Done when: a dispute created with the Paystack simulate route can be moved through its states and opens its order.

### B2. Refund and return decision queue
- Same area. A tab listing orders with **pending return requests** and **refunds that failed/are pending**, oldest first, with paging.
- Use `GET /api/orders/admin/{id}`, `POST /api/orders/admin/{id}/refunds` (reauth + Idempotency-Key, amount typed in ₦ not kobo),
  `POST /api/orders/admin/{id}/returns/{returnId}/decision` (reason via an inline composer, not `window.prompt`).
- If you need a list endpoint the server doesn't have, ask Claude to add it rather than reading everything client-side.
- Also: ledger "brand" filter (`GET /api/admin/finance/ledger?brandId=`).

## C. Search — finish task 8

- Files: `src/components/market/catalog/catalog-state.ts`, `catalog-listing.tsx`, `catalog-search.tsx`, `filter-controls.tsx`, `filter-sheet.tsx`.
- The shop/category results, facets (category, brand, price) and price filter must come from
  `GET /api/search?q=&category=&brand=&min=&max=&currency=&cursor=` — not from filtering the loaded catalogue in the browser.
  Prices in the response are minor units in the shopper's currency.
- Keep the URL as the source of truth for filters (existing behaviour), add "Load more".
- Done when: searching "jacket" on `/shop` with a brand + price filter returns the same items as the API, including products created in Studio.

## D. Following page overflow — finish task 10

- File: `src/components/market/account/following-feed.tsx` (+ `src/app/(market)/following/page.tsx`).
- At 320px the page is ~358px wide. Find the element that doesn't shrink (long brand handle/name or a fixed-width rail):
  add `min-w-0` on flex/grid children, `grid-cols-[minmax(0,1fr)]`, `break-words`/`truncate` on long text.
- Done when: no sideways scroll at 320 and 390, signed in with several follows.

## E. Studio collections — finish task 6

- Files: `src/components/studio/catalog/collections-view.tsx`, `collection-dialog.tsx` (today read-only and only reachable from the product editor).
- API: `GET/POST /api/studio/catalog/collections`, `PATCH/DELETE /api/studio/catalog/collections/{id}` (send `version`; 409 → Reload),
  `PUT /api/studio/catalog/collections/{id}/products` (ordered product ids).
- Create, rename, reorder products, publish/unpublish, delete — from the Collections page, using the tray pattern (no new modal for typed values).
- Public read: `GET /api/catalog/storefronts/{handle}/collections/{collection}` — switch the public collection page to it.
- Done when: a collection made in Studio shows on the brand's public collection page in the right order.

## F. Studio storefront editor — task 5 (not started)

- Files: `src/components/studio/storefront-editor/*` (`storefront-editor.tsx`, `model.ts`, `sections-controls.tsx`, `content-controls.tsx`,
  `design-controls.tsx`, `photo-picker.tsx`, `preview-frame.tsx`), page `src/app/studio/(workspace)/storefront/page.tsx`.
- API:
  - `GET /api/studio/storefront` → `{ draft, revision, live, version }`
  - `PUT /api/studio/storefront/draft` with `revision` (autosave with debounce; 409 → "Someone else edited this — Reload")
  - `POST /api/studio/storefront/publish` with the live `version`
  - `GET /api/studio/storefront/versions/{version}`, `POST /api/studio/storefront/versions/{version}/restore`
- Photos: upload through the existing uploads flow (cover/section images must become public once published — tell Claude if they stay private).
- Public brand page: `src/app/(market)/brands/[handle]` must read `GET /api/catalog/storefronts/{handle}` (published version only).
- Remove the local/sample storefront store for real brands; keep it for demo brands.
- Done when: edit → autosave → publish → the public brand page shows it; restore an older version works; two tabs get the conflict message.

## G. Drops and draws — task 7 (not started, biggest)

**Shopper**
- Files: `src/app/(market)/drops/(index)`, `src/app/(market)/drops/[slug]`, `src/components/market/drop-card.tsx`, `countdown.tsx`,
  `notify-button.tsx`, `use-drop-add-block.ts`, the Discover drops marquee.
- API: `GET /api/drops` (list), `GET /api/drops/{id}` (includes `me.canBuy`, `me.reason`, `me.entry`, `me.reminder`),
  `POST/DELETE /api/drops/{id}/reminder`, `POST/DELETE /api/drops/{id}/entry` (draws), `GET /api/drops/me`,
  `GET /api/drops/{id}/draw` (public fairness info: seed hash before, seed after).
- Show `me.reason` when the shopper can't buy (limit reached, draw not won, not started). **Don't re-implement limits** — checkout enforces them.
- Times are absolute (UTC from the server) — show in the shopper's time zone.

**Studio**
- Files: `src/app/studio/(workspace)/drops/*` (index, `new`, `[id]`).
- API: `GET /api/drops/studio`, `POST /api/drops` (draft), `PATCH /api/drops/{id}` with `expectedVersion` (409 → Reload),
  `POST/DELETE /api/drops/{id}/schedule`, `POST /api/drops/{id}/cancel`, `POST /api/drops/{id}/draw` (run the draw now).
- Role: drops are managed by owner/admin/designer (`content.publish`) — hide controls for others.
- Done when: a brand creates a draw drop → schedules it → shoppers enter → the draw runs → winners can buy within their window and others can't;
  reminders fire (check the email outbox in dev).

---

## Order

1. A (onboarding sign-up + review note) — blocks real brands joining.
2. B (disputes + refund/return queue) — blocks handling money problems.
3. D (Following overflow) — 15 minutes.
4. C (search) and E (collections).
5. F (storefront editor).
6. G (drops and draws).

## Still not code (your checklist)
Paystack live keys + webhook URL + check Nigerian bank codes in `src/components/studio/business/settings-model.ts`;
email provider + domain DNS; `YARD_PUBLIC_URL`, `YARD_ENCRYPTION_KEY` (keep a copy), `YARD_SUPPORT_EMAIL`, `YARD_BUSINESS_ADDRESS`;
legal pages; hosting (Pxxl: always-on Node, single instance, Postgres backups) — Claude prepares hosted Postgres + R2 + deploy guide;
first admin: `npm run admin:create -- --email … --name … --role owner`; one real small-money test (pay, refund, payout).

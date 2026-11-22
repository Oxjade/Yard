# Studio in the app, and "Sell on Yard"

Contract: website repo `docs/APP.md` › "Studio in the app" (+ "Push notifications"), server commit
f235247. Everything here calls only those endpoints. The iOS app has no Studio yet; this is the
reference for it.

Code: `features/sell/` (role screen, short application, You card) and `features/studio/` (store,
API, shell, screens). Shared pieces in the design system: `designsystem/Haptics.kt`
(`rememberYardHaptics()`), `designsystem/components/SlideToComplete.kt`, colour tokens
`violetFill` (#9452FF) / `onVioletFill`.

## Category-neutral

Never a hard-coded category list or apparel words: category chips come from
`GET /api/catalog/categories` (in the server's order, `slug` sent); copy says products / pieces /
shop; option names are free text (Size is one of many: Colour, Scent, Volume…), products may have
no options.

## 1. Shop or sell (`RoleSelectionView`)

- Full screen, shown by `RootView` over everything when `StudioStore.needsRoleChoice`: signed in, not
  the demo shopper, no brand memberships, and this account never answered on this device
  (`StudioPrefs.roleChoice`, SharedPreferences `yard.role.<userId>`). That covers new sign-ups
  (`SignInView` closes so the root can ask) and existing accounts that never chose.
- Two bold cards with animated, native illustrations (`features/sell/SellIllustrations.kt`):
  **Shop on Yard** (acid): three product cards fan out behind a shopping bag with depth, a price tag
  swings on a string, sparkles twinkle, a slow bob. **Sell on Yard** (black, violet glow): a shopfront
  whose awning ripples, an "OPEN" sign that flips, a parcel that pops out and hops, a sales sparkline
  that draws up. Entrance is a staggered spring; idle loops are low amplitude; pressing a card tilts
  it in 3D toward the finger with the art's layers shifting by depth (parallax) and a tick. Geometry
  is cached (`drawWithCache`), motion is read in the draw phase only (no recomposition), loops stop
  when not composed, and reduced motion shows the final pose. Back = shop.
- Shop → straight in. If this device never did the Welcome picks (`AuthOnboarding.onboarded`), one
  optional, skippable "Pick what you're into" step (categories via `WelcomeModel`, saved to
  `AuthOnboarding.interests`, marks onboarded). Otherwise no step at all.
- Sell → `StudioStore.openApplication()`.

## 2. The short application (`SellApplicationView`, `SellApplicationModel`, `SellRules`)

One question per screen on bold full-bleed colour (violet, acid, violet, acid, then black), a springy
progress bar with "n/5", big inputs, black pill "Continue". Each step is validated with the server's
own rules (`SellRules`, mirrors `studioApplyBody`) before it moves on; a reject haptic and the
sentence under the input otherwise.

1. "What's your brand called?" (2–40) with a live preview card of the shop on Yard.
2. "Where can we see your stuff?" Instagram / Website toggle (one is enough; the `@` is a prefix,
   handles and instagram.com links accepted). With a website: "We'll pull in your products…".
3. "What do you sell?" multi-tap category chips with tick haptics. **The API takes one category: the
   first chip tapped is the primary and is the one sent** (marked ★); the others are not sent.
4. "Where are you based?" city + country chips (the 11 countries the API accepts, flags, names in
   the phone's language); the country defaults to the phone's region when Yard sells there.
5. Review (tap a row to edit) → **Slide to apply** → `POST /api/studio/apply` (blank optional
   fields omitted: the body is strict).

Then "You're on the list. We'll review {Brand} and let you know." on acid with an animated
"ON THE LIST" tag stamp (slams down with a squash and shake, bursts confetti, then sways; static
under reduced motion; Quick add's success uses the same stamp with "LIVE") and a success haptic; when `websiteScan.status`
is `started` it adds "We'll pull in your products from {site}…". "Back to shopping" re-reads the
session (the new shop appears in `shopper.brands` as `pending_review`).

Errors: 400 `fields.*` jump back to that step with the server's sentence; 409 (an application in
progress on the website), 422 (already approved, on hold, demo) and others show the server's words
above the slider; 429 → "That's a lot of tries…"; offline → the network sentence. The slider springs
back. If `GET /api/studio/apply` already has one waiting, the flow opens on "You're already on the
list." A rejected application pre-fills the name.

You tab (`YouSellerCard`): "{Brand}: in review" (violet, Open Studio), "Run {Brand}" (members,
Switch to Studio), or "needs changes" + `reviewNote` with Apply again.

## 3. Studio mode

### Sessions (`StudioStore`, app-scoped, `LocalStudioStore`)

- Brands: `GET /api/session` → `shopper.brands[]` (`ShopperBrand`: id, handle, name, logoSrc,
  initials, role, status, canOpenStudio). Studio shows for brands with `canOpenStudio`.
- Mode: after sign-in / launch, Studio opens by default when the account has a Studio-capable brand,
  unless the person last chose shopping (`StudioModeRules.initialMode`, remembered in
  `yard.studio.mode`). The brand is the remembered one (`yard.studio.brand`) or the oldest that can
  open. Switch: You › "Switch to Studio" (and the seller card); Studio › Me › "Switch to shopping".
  The shopping shell stays composed (tabs keep their state) but is hidden while Studio shows.
- Brand session: `StudioStore.call { }` runs `POST /api/studio/session/switch { brandId }` before
  the first Studio call and whenever the active brand changed; on a 401 from any `/api/studio/…`
  call it switches again silently and retries once; a 401 from the switch means the shopper session
  is gone (session re-read, `StudioSignedOut`). The switch's `profile.permissions` hide actions
  (`orders.fulfil`, `content.publish`, `inbox.read`, `inbox.reply`); payouts only for owner, admin,
  finance.
- Several brands: the brand mark (Home) or Me › Switch brand opens the picker sheet; a change bumps
  `StudioStore.generation`, which reloads every Studio screen.
- Sign out (Me): the app's normal sign-out; `YardApp` registers a before-sign-out step so the order
  is `DELETE /api/devices`, `POST /api/auth/sign-out?actor=brand`, then `?actor=shopper`.

### Shell (`StudioRootView`, `StudioNav`)

A near-black floating bar (`studioBar`, 24dp corners) with four plain icons: Home, Orders, Products,
Me; the selected one sits in a violet pill (`studioAccent`) that springs between tabs; tick haptic.
No centre Add: Quick add opens from Home's "Add product" tile and the Products header (+), both
`nav.select(StudioTab.Add)` as before. One stack per tab (plain state, no NavHost), push/pop slides
(instant under reduced motion), system back pops, then goes Home, then backgrounds the app. Tablets:
a centered readable column.

### Home (`StudioHomeView`) — wallet style

Tokens `Color.yard.studio*` (Theme.kt; same values in iOS `Theme.swift`): violet #8B68FF hero,
#7350EE inset card, pure black / #F5F5F7 canvas, #1A1A1A / #E9E9EE tiles, one contrast tile
(white in dark, black in light). One `GET /api/studio/dashboard?days=7` (its `sales` has today /
week / month).

- Violet hero, edge to edge from the status bar, 32dp bottom corners: avatar (logo or initials),
  "Hello 👋 / {shop}", inbox button (dot when `unreadMessages > 0`); "Your sales" with Today / Week /
  Month (Month first), the net amount, and a pill: Month "+₦… past week", Week "+₦… today", Today
  "N orders" ("No orders …" at zero).
- Inset card (one, closable for the visit): restricted → Message Yard Support; suggestions waiting →
  "Yard prepared N products for you" + Accept all; in review → Add a product; no orders in 30 days →
  Share shop. White pill CTA with a black › disc and ».
- Four action tiles: Add product (violet disc), Orders, Payouts, Share shop.
- Orders tile (contrast) for the picked window with refunds; Weekly activity: 7 bars on faint tracks,
  today violet, grows in (instant under reduced motion).
- To-do rows (violet-tinted icon disc, count, chevron): suggestions (when the card is closed or shows
  something else), orders to ship, low stock, unread messages, new from your website; "All caught up"
  when empty. "Your shop": shop views and top products.
- Loading keeps the hero (amount as soft blocks) and shows tile/row skeletons in place. Error with
  retry, pull to refresh. Screenshots: `studio-home`, `studio-home-loading`, `studio-home-new`.

### Orders (`StudioOrdersView`, `StudioOrderDetailView`) — tracking style

Tabs New (`fulfilment=unfulfilled`), To ship (`processing`), Shipped (`shipped`), Done (`delivered`
+ `cancelled`, two queries merged newest first) with badges from the dashboard's `toShip.paid` /
`toShip.processing`; paging by `before`. Detail: black card with reference, status, total and a
received → preparing → shipped → delivered progress line (times from `paidAt`, the timeline,
`deliveredAt`); items with their option values (`variantLabel`); the customer and address (the
free-form `shipTo`). Actions by permission: Start preparing (`/processing`), carrier + tracking then
**Slide to mark shipped** (`/shipment { status: "shipped" }`, a tracking number needs a carrier),
Cancel (reason, restock switch, new idempotency key per tap, only when `actions.canCancel`), Refund
(owner/admin, ≤ `refundableMinor`). **Re-confirm:** a 403 with `fields.reauth = "required"` opens
"Confirm it's you": the password (`POST /api/auth/reauth?as=brand`) or each provider in
`fields.reauthWith` (Custom Tab sign-in with `actor=brand`, then `POST /api/auth/brand/switch` to keep
the fresh re-confirmation on this brand), then the action runs again.

### Add (`StudioQuickAddView`) — Quick add

Photos (library via the photo picker or the camera, each through the profile photo's square crop,
`YouPhotoCropDialog`; up to 12; first is the cover) → name + category chips → price (brand currency
from the dashboard) → options & stock (0–3 generic options, values as chips, stock stepper per
variant; no options = one stock count) → review → **Slide to publish**: `POST /api/uploads?
purpose=social_post&as=brand` per photo, `POST /api/studio/catalog/products` (a draft; SKUs
`HANDLE-TITLE-OPTION`, uppercase, ≤ 64, unique), then `POST …/{id}/status { publish }`. A brand in
review/restricted or without `content.publish` gets "Slide to save draft"; a publish refusal keeps
the draft with the server's reason. Success: "It's live." with confetti and **Share link**.

### Products (`StudioProductsView`)

Search (debounced), All / Live / Draft / Low stock, rows with Live/Draft pill and stock, paging by
offset. "New from your website (N)" banner → list with Add / Skip (`mayAdd`, 409 handled). Detail:
stock per variant with − / + (tick haptic, shown at once, undone on a 422), **Slide to publish** for
drafts, Unpublish for live products (`expectedVersion`; a 409 reloads).

### Accept all: Suggestions from Yard and New from your website (`StudioSuggestionsView`)

Server commit ec10c4a. **Suggestions from Yard** (`GET /api/studio/proposals?status=all`, pushed on
the Products tab): "Yard prepared N products for you" card (acid outline when opened with
`focus=accept-all`) with **Slide to accept all (N)** (`POST /api/studio/proposals/accept-all`, no `ids`),
Select / Done mode with round ticks and "Select all", **Accept selected (k)**, and **Decline all /
Decline selected** behind an inline confirm with an optional reason (`/decline-all`, ≤ 300 chars,
blank omitted). Suggestions the server skipped stay in "Waiting for you" with their `reason` in red
(declines prefixed "Not declined: "); "Answered" lists the rest. Without `content.publish` the batch
actions are hidden. **New from your website** gets **Add all (N)**, a tick on each waiting piece,
**Add selected (k)** (`POST /api/studio/catalog/website-pieces/add-all`); the response is the refreshed
list, and a skipped piece shows its reason (or its `error` on the next load).
Both use `StudioActionKey`: one `idempotencyKey` (32 hex chars) per tap, **kept after a failure** so a
retry after a dropped connection gets the first result (`replayed`), renewed after an answer. Success
haptic and a toast on a batch that did something, reject haptic otherwise. Home's To do and the
Products tab show the waiting count ("Yard prepared N products for you · Accept all in one tap") and
open the list with Accept all in focus; the dashboard has no count, so both call `?status=pending`.

### Me (`StudioMeView`) — grouped rows

Balance card (available, pending, on its way, hold reason) → Payouts (history, payout account status;
"Add a payout account" opens the website's /studio/payouts: the app has no bank flow in v1). Inbox
(unread badge, list, thread with text replies, read receipts, light polling) and Yard Support
(`/api/studio/support/…`). View shop (Custom Tab) and Share shop. Notification switches
(`GET/PUT /api/studio/settings/notifications`, optimistic, undone on error) and "Send a test
notification" (`POST /api/studio/push/test`, with the devices/delivered explanation). Switch brand,
Switch to shopping, Sign out.

## 4. Push and deep links

- `POST /api/devices` carries `studio: true` while the account is a brand member.
- Studio pushes (`data.scope == "studio"`) open `data.link`; `StudioPushTap` reads our own
  notification's extras or FCM's background extras. `StudioStore.openLink(link, brandId)` switches to
  that brand (re-switching the session), enters Studio and `StudioNav.show(link)` opens the screen.
  A cold start waits for the session (`resolvePendingLink`); accounts without Studio drop the link.
- `yard://studio` (home), `yard://studio/orders[/{id}]`, `yard://studio/inbox[/{conversationId}]`,
  `yard://studio/support`, `yard://studio/products[/{id}]`, `yard://studio/payouts`; the web paths
  (`/studio/orders/{id}`, `/studio/inbox?thread={id}`, …) map the same way.
- `/studio/products/suggestions?focus=accept-all` (the batch notification, email and Overview card)
  → `StudioLink.Suggestions(focusAcceptAll = true)`; `/studio/products/suggestions/{id}` opens the list
  (no single-suggestion screen in the app). A shopper-scoped notification whose href is a `/studio/…`
  path (tapped push or a row in Notifications) opens Studio the same way.

## Haptics and motion

`rememberYardHaptics()` (View haptics, so the system's touch-feedback setting is honoured): tick for
chips/tabs/steppers, click for buttons, rising ticks while sliding + a threshold bump + confirm on
release, success (two pulses) on submit/publish/ship, reject on errors. `SlideToComplete` must travel
90%; TalkBack double-tap / its custom action and a long-press on the pill complete it too.
Springs everywhere (`Motion.*`), all instant under reduced motion (`rememberReducedMotion`).

## Tests

`app/src/test/java/…/features/studio/StudioTest.kt`: session brands parsing, mode/brand rules, role
choice, switch-before-call / re-switch-and-retry-once on 401 / give up / brand change / switch 401,
link waiting for the session, dashboard + order detail parsing, orders page merge, application step
validation and body, You card state, deep links, push taps, nav routing, slide threshold and ticks,
Quick add variants / SKUs / body / prices, re-confirm parsing. Motion frames: `MotionFramesTest` (test clock, frames at 0–4600 ms → `build/outputs/roborazzi/motion/`). Screenshots: `ScreenScreenshotTest`
`YardScreens.studio` (FakeYardBackend serves the Studio endpoints from `StudioFixtures`).

## Contract gaps / notes

- The application takes one `category`; the app sends the first chip tapped (documented above).
- `websiteScan` comes back only after submitting, so the website hint before that is the app's own
  sentence; the scan result shows on the success screen.
- The website validation message "Enter your website address, like yourshop.com." is in
  `studio-app.ts` but not in APP.md's list.
- No endpoint lists orders by "New" vs "To ship" beyond `fulfilment=unfulfilled|processing`;
  "Done" needs two queries (delivered, cancelled) because `fulfilment` takes one value.
- Payout account setup and payout requests stay on the website for v1 (as the contract says).
- Inbox photos and product cards from the brand side aren't sent from the app yet (text replies);
  `POST /api/uploads?purpose=inbox_attachment&as=brand` exists for a later version.

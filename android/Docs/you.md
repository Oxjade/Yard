# You (features/you)

Mirrors `ios/Yard/Features/You` file for file (same names, copy, endpoints and states).

## Screens
- `YouView()` — tab root. Signed out: "Your World" invite card (Sign in / Create account → `Route.SignIn`). Loading: skeleton header. Signed in: editorial header (initials avatar, tracked small-caps greeting, name, email); ONE quick-links panel (`YouQuickLinks.kt`: a rounded surface with a 3 × 2 grid of icon-over-label cells and hairline separators — Orders, Saved, Following, Inbox, Drop reminders, Updates; press = 0.96 scale + highlight + light haptic) with live state from `YouBadgesModel` (inbox unread dot ← `/api/inbox/unread`, Updates unread count ← `/api/notifications?as=shopper`, Orders in-progress count ← `/api/orders`, active drop reminders ← `/api/drops/me`, Saved/Following totals ← the stores; unknown or zero hides the badge; refreshed when the You tab is selected (hidden tabs stay RESUMED, so a tab switch fires no ON_RESUME), on resume while You is showing, on sign-in change and on pull to refresh; sign-out resets and cancels any load in flight); Settings / Help / Sell on Yard; Legal (Terms, Privacy, Refunds). **Selling** (`features/sell/YouSellerCard.kt`, Docs/studio.md): under the header, "{Brand}: in review" (violet card, `shopper.brands` status `pending_review`, Open Studio), "Run {Brand}" / Switch to Studio for brand members, or "needs changes" with the review note after a rejected application (GET /api/studio/apply, only for people who answered Sell). The links row says Switch to Studio for members, Sell on Yard (the in-app application) for signed-in shoppers, and the website's /sell signed out. Pull to refresh (`PullToRefreshBox` → `session.refresh()`), tab-pill scroll sensor, edge to edge.
- `SettingsView()` — grouped cards (reference 08): General (Appearance, Notifications, Ship to, Currency), Account (Your details, Addresses, Change/Set password, Delete account or "Deletion requested"), Sign-in methods (Disconnect behind an AlertDialog; "Connect on the web"), Help and legal, Sign out. Signed out: sign-in card instead of Account.
- `AppearanceView()` — three swatches (drawn with the fixed `YardColors.Light/Dark` sets) + checklist; writes `AppearanceStore` (DataStore `appearance`).
- `NotificationSettingsView()` — topics, Email channel, "Push on this phone" (opens the system's app-notification settings), read receipts; each switch saves at once with the site's email rule; skeleton / error / signed-out states.
- `AddressesView()` — honest empty state (no address-book API) + Ship to / Currency.
- `LegalView(page)` — the website page in an `android.webkit.WebView`, skeleton while loading, error + retry, "Open in browser" (Custom Tab) top-bar action.
- Sheets (`YouSheet` = `YardSheet` + own toast host + hide animation + dismiss lock): `YouRegionSheet`, `YouChangePasswordSheet`, `YouDeleteAccountSheet`. Your details is a page (`YouAccountView`).

## Your details (name and email) — `YouAccountView()`, `Route.Account`

Settings › Account › Your details is a page (two-pane: `YouSettingsPage.Account`). It replaced the read-only sheet and its "isn't available in the app yet" note.
- `GET /api/account?as=shopper` → `AccountDto`; re-read on every resume and whenever the session's email changes.
- Name: sign-up rules (`youNameError`: trimmed, 1–80, no control characters or `<` `>`), `PATCH /api/account?as=shopper { name }`, then `session.refresh()`.
- Email: `POST /api/account/email?as=shopper { email, currentPassword? }` (password only when `hasPassword`); local checks (`youEmailChangeErrors`), server `fields.email` / `fields.currentPassword` under their fields, 422/429 as a form error. Pending card ("We sent a link to …", expiry) with Resend link (password accounts re-open the form with the address filled in), Use a different email, Cancel change (`DELETE /api/account/email?as=shopper`). Demo accounts: "Demo accounts can't change their email."
- No password + 403 `fields.reauth = "required"`: "Confirm it's you" with Continue with Google/Apple/… (the account's `signInProviders` × `GET /api/auth/providers`): the normal Custom Tab hand-off (`AuthAppHandoff.begin`; the panel counts as the waiting sign-in screen so no sign-in sheet opens over it); on success (same shopper) the request is sent again. Accounts with no provider and no password (magic link) are told to sign out and back in first.
- The link in the email (`/auth/change-email?token=`) is an `/auth` App Link, so the app finishes it: `AuthEmailLinks` POSTs `/api/auth/change-email/confirm { token }`, refreshes the session and toasts "Your Yard email is now …" (or the server's message for a used/expired link). In a browser the website page does the same; the app re-reads on resume.

## Tablet & large screens
- `YouView`: the scrolling column is capped at `contentMaxWidth` (whole width still scrolls); the quick-links panel is one row of six cells on `isWide` (`youTileColumns`: 3 → 6).
- `SettingsView`: `ListDetailLayout` on Expanded — settings list on the left, the selected sub-page (`YouSettingsPage`: Appearance, Notifications, Addresses, Terms, Privacy, Refunds, Data deletion) on the right without a back button (`LocalBackAction provides null`), selection in `rememberSaveable`, selected row highlighted (`surface2`, `selected` semantics), "Pick a setting" `EmptyState` when nothing is selected. Help, Ship to / Currency and the account sheets keep opening as before. Medium/Compact push the routes as on phones.
- Appearance, Notifications, Addresses: content capped with `adaptiveContentWidth()`; Legal: the WebView sits in `AdaptiveContent`.
- `YouSheet(presentAsDialogOnWide = true)` for the tall sheets (Ship to / Currency, Change password, Delete account) → centered dialog on wide windows; Your details stays a bottom sheet.
- `@YardTabletPreviews` on YouView, SettingsView, AppearanceView, NotificationSettingsView, AddressesView, LegalView.

## Endpoints
- `GET/PATCH /api/account?as=shopper`, `POST/DELETE /api/account/email?as=shopper`, `POST /api/auth/change-email/confirm` (Your details)
- `GET /api/auth/security?as=shopper`, `DELETE /api/auth/identities/{id}?as=shopper`
- `POST /api/auth/password/change?as=shopper` `{ currentPassword?, newPassword }`
- `POST /api/auth/reauth?as=shopper` `{ password }` then `POST /api/auth/account/delete` `{ confirm: "DELETE" }`
- `GET/PATCH /api/notifications/preferences?as=shopper` `{ email?, inApp? }` (categories drops, price_drops, back_in_stock, brand_news)
- `GET/PATCH /api/inbox/settings` `{ readReceipts }`
- Sign out: `SessionStore.signOut()`.

## Profile photo (YouPhoto.kt, YouPhotoViews.kt, YouAvatar.kt)
docs/APP.md › Profile photo; website `account-photo.tsx` + `photo-crop.ts`.
- Settings › Your details › Photo: tap the avatar (camera badge) or Change photo → an action sheet: Choose from library
  (system photo picker, `PickVisualMedia`, no permission), Take photo (the camera app via `TakePicture` into
  `cacheDir/photos` through the `…photos` FileProvider; no CAMERA permission is declared, so none is needed — Android's
  equivalent of iOS's usage strings; hidden without a camera), Remove photo (confirmed inside the same sheet, like
  "Cancel this order?"; there is no modal dialog).
- Opening: the website's checks (JPEG/PNG/WebP/HEIC, ≤ 10 MB, not empty, ≥ 64 px), decoded upright (ImageDecoder on
  API 28+, which also reads HEIC; BitmapFactory + EXIF rotation below), long side capped at 4096 px.
- Crop: full-screen, always dark (like the product photo viewer). Drag, pinch around the fingers, double-tap 1×↔2×,
  zoom slider and ± buttons (1–4×); the photo always covers the square; outside the circle is dimmed. Double-tap /
  button zoom animate with `Motion.spring()`, instant under reduced motion. TalkBack custom actions move and zoom.
- Save: crop → JPEG ≤ 1024 px, quality 90 (re-encode drops EXIF/GPS) → `POST /api/account/photo?as=shopper`, one
  multipart part `file` built by `APIClient.makeMultipartRequest` (Origin + X-Yard-Client; fixed length, so
  `Content-Length`, never chunked), wrapped to report progress. Optimistic: the crop shows at once with a progress
  ring; failure brings the saved photo back dimmed with the reason, Try again (network, 429, 5xx) and Discard.
- Copy (website): 413 "Photos can be up to 10 MB.", 415 "Yard couldn't read this as a JPEG, PNG or WebP photo. Try
  another one.", 429 "You've changed your photo a lot. Try again in N min." (`Retry-After`), 422 / others = the
  server's message (incl. "Demo accounts can't change their photo."), 401 → message + Sign in. Demo accounts see the
  controls disabled and that sentence.
- Showing it: `YouAvatar` (photo over the acid initials disc; initials on missing/failed/404; fades in, instant under
  reduced motion) in the You header (`session.shopper.photoSrc`, added to `Shopper`), the Settings "Your details" row
  and Your details. After a change: the account from the response is applied, `session.refresh()` re-reads
  `photoSrc`, and the old URL is evicted from Coil's memory and disk caches (new photos get new URLs anyway).
- Not done: the upload runs in the Your details view model, so leaving that screen mid-upload cancels it (the old photo
  stays); brand-side photos (`conversation.customer.photoSrc`) are Studio-only and not in the app.

## Helpers (YouSupport.kt)
`YouMarkets` (copy of src/config/markets.ts), `YouRegion` (ship-to in `Config.preferences` key `yard.shipTo`, `yard.currencyChosen`), `YouWebPage` (Help / Sell / web settings via `WebPages`), `YouSettingsGroup`, `YouToggleRow`, `YouTextField`, `YouSkeletonRow`, `Modifier.youRowClick`, security DTOs.

## Tests
`app/src/test/java/space/yardstore/app/features/you/`: `YouTabletTest` (settings page → route mapping, tile columns), `YouModelsTest` (DTO decoding/encoding, password and delete rules, markets, reauth detection) and `YouViewModelsTest` (`YouNotificationsModel`, `YouSecurityModel` against MockWebServer), `YouQuickLinksTest` (badge rules, live counts, throttle, partial failure, reset cancels a load in flight), `YouPhotoTest` (crop math, picked-file checks, the multipart request + Content-Length + progress, error copy for 413/415/422/401/429/5xx, optimistic save / retry / discard / remove), `YouAccountTest` (16: name/email rules, AccountDto, exact request bodies, error mapping, reauth, pending/cancel/refresh, change-email confirm). Models take `(api, root)` so tests can point them at the mock server.

## Differences from iOS
- Web pages open in Custom Tabs, not SFSafariViewController. Legal WebView shares the system WebView cookie store (iOS used a non-persistent store); it doesn't force dark styling of the web page (iOS doesn't either).
- "Push on this iPhone / iOS Settings" → "Push on this phone / System settings" (app notification settings). Push itself (FCM) isn't wired in the app yet (see foundation.md).
- Footers say "this phone" / "your phone's" instead of "this iPhone" / "your iPhone's".
- Sign-in method icons: no Google/Apple logos in material icons — AccountCircle / PhoneIphone stand in.
- No password-manager autofill hints on the account-sheet fields (iOS `textContentType`).
- Same open items as iOS: Google/Apple linking happens on the web.
- After "Delete my account" succeeds, the sheet calls `onDeleted` and SettingsView refreshes the session, pops to You and toasts in its own scope (the sheet's scope is cancelled when it closes; on iOS the `Task` survives `dismiss()`).
- The change-password sheet can't be swiped away while saving (closing would cancel the request's coroutine).
- `YouToggleRow` is a single `toggleable` (role Switch) row; the switch inside is display-only, so TalkBack reads one switch with its title and detail.
- Root suggestion (orchestrator): call `YouRegion.restore(cart)` at launch; today it runs when Settings or Addresses appear.

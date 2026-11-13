# You (features/you)

Mirrors `ios/Yard/Features/You` file for file (same names, copy, endpoints and states).

## Screens
- `YouView()` — tab root. Signed out: "Your World" invite card (Sign in / Create account → `Route.SignIn`). Loading: skeleton header. Signed in: initials avatar, greeting, name, email; six tiles (Orders, Saved + count, Following + count, Inbox, Drop reminders, Updates); Settings / Help / Sell on Yard; Legal (Terms, Privacy, Refunds). Pull to refresh (`PullToRefreshBox` → `session.refresh()`), tab-pill scroll sensor, edge to edge.
- `SettingsView()` — grouped cards (reference 08): General (Appearance, Notifications, Ship to, Currency), Account (Your details, Addresses, Change/Set password, Delete account or "Deletion requested"), Sign-in methods (Disconnect behind an AlertDialog; "Connect on the web"), Help and legal, Sign out. Signed out: sign-in card instead of Account.
- `AppearanceView()` — three swatches (drawn with the fixed `YardColors.Light/Dark` sets) + checklist; writes `AppearanceStore` (DataStore `appearance`).
- `NotificationSettingsView()` — topics, Email channel, "Push on this phone" (opens the system's app-notification settings), read receipts; each switch saves at once with the site's email rule; skeleton / error / signed-out states.
- `AddressesView()` — honest empty state (no address-book API) + Ship to / Currency.
- `LegalView(page)` — the website page in an `android.webkit.WebView`, skeleton while loading, error + retry, "Open in browser" (Custom Tab) top-bar action.
- Sheets (`YouSheet` = `YardSheet` + own toast host + hide animation + dismiss lock): `YouRegionSheet`, `YouAccountDetailsSheet`, `YouChangePasswordSheet`, `YouDeleteAccountSheet`.

## Tablet & large screens
- `YouView`: the scrolling column is capped at `contentMaxWidth` (whole width still scrolls); the six quick tiles sit in one row on `isWide` (`youTileColumns`: 3 → 6), equal height per row.
- `SettingsView`: `ListDetailLayout` on Expanded — settings list on the left, the selected sub-page (`YouSettingsPage`: Appearance, Notifications, Addresses, Terms, Privacy, Refunds, Data deletion) on the right without a back button (`LocalBackAction provides null`), selection in `rememberSaveable`, selected row highlighted (`surface2`, `selected` semantics), "Pick a setting" `EmptyState` when nothing is selected. Help, Ship to / Currency and the account sheets keep opening as before. Medium/Compact push the routes as on phones.
- Appearance, Notifications, Addresses: content capped with `adaptiveContentWidth()`; Legal: the WebView sits in `AdaptiveContent`.
- `YouSheet(presentAsDialogOnWide = true)` for the tall sheets (Ship to / Currency, Change password, Delete account) → centered dialog on wide windows; Your details stays a bottom sheet.
- `@YardTabletPreviews` on YouView, SettingsView, AppearanceView, NotificationSettingsView, AddressesView, LegalView.

## Endpoints
- `GET /api/auth/security?as=shopper`, `DELETE /api/auth/identities/{id}?as=shopper`
- `POST /api/auth/password/change?as=shopper` `{ currentPassword?, newPassword }`
- `POST /api/auth/reauth?as=shopper` `{ password }` then `POST /api/auth/account/delete` `{ confirm: "DELETE" }`
- `GET/PATCH /api/notifications/preferences?as=shopper` `{ email?, inApp? }` (categories drops, price_drops, back_in_stock, brand_news)
- `GET/PATCH /api/inbox/settings` `{ readReceipts }`
- Sign out: `SessionStore.signOut()`.

## Helpers (YouSupport.kt)
`YouMarkets` (copy of src/config/markets.ts), `YouRegion` (ship-to in `Config.preferences` key `yard.shipTo`, `yard.currencyChosen`), `YouWebPage` (Help / Sell / web settings via `WebPages`), `YouSettingsGroup`, `YouToggleRow`, `YouTextField`, `YouSkeletonRow`, `Modifier.youRowClick`, security DTOs.

## Tests
`app/src/test/java/space/yardstore/app/features/you/`: `YouTabletTest` (settings page → route mapping, tile columns), `YouModelsTest` (DTO decoding/encoding, password and delete rules, markets, reauth detection) and `YouViewModelsTest` (`YouNotificationsModel`, `YouSecurityModel` against MockWebServer). Models take `(api, root)` so tests can point them at the mock server.

## Differences from iOS
- Web pages open in Custom Tabs, not SFSafariViewController. Legal WebView shares the system WebView cookie store (iOS used a non-persistent store); it doesn't force dark styling of the web page (iOS doesn't either).
- "Push on this iPhone / iOS Settings" → "Push on this phone / System settings" (app notification settings). Push itself (FCM) isn't wired in the app yet (see foundation.md).
- Footers say "this phone" / "your phone's" instead of "this iPhone" / "your iPhone's".
- Sign-in method icons: no Google/Apple logos in material icons — AccountCircle / PhoneIphone stand in.
- No password-manager autofill hints on the account-sheet fields (iOS `textContentType`).
- Same open items as iOS: no profile-update endpoint (details are read-only), Google/Apple linking happens on the web, tiles for Orders/Inbox/Drop reminders have no counts.
- After "Delete my account" succeeds, the sheet calls `onDeleted` and SettingsView refreshes the session, pops to You and toasts in its own scope (the sheet's scope is cancelled when it closes; on iOS the `Task` survives `dismiss()`).
- The change-password sheet can't be swiped away while saving (closing would cancel the request's coroutine).
- `YouToggleRow` is a single `toggleable` (role Switch) row; the switch inside is display-only, so TalkBack reads one switch with its title and detail.
- Root suggestion (orchestrator): call `YouRegion.restore(cart)` at launch; today it runs when Settings or Addresses appear.

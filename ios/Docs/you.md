# You (Features/You)

## Screens
- `YouView()`: the You tab root. Signed out: an invite card ("Your World", using the site's wording), with Sign in and Create account. Both present `.signIn`, because `SignInView` has no mode parameter. Signed in: an initials avatar, a greeting, name and email; six quick tiles (Orders, Saved with its count, Following with its count, Inbox, Drop reminders, Updates → `.notifications`); links to Settings, Help and Sell on Yard; and the legal links (Terms, Privacy, Refunds). It is pull-to-refresh. While the session loads it shows a skeleton header.
- `SettingsView()`: grouped cards with icon tiles, in the style of reference 08.
  - **General**: Appearance, Notifications, Ship to, Currency. Ship to and Currency open a sheet with the site's country and currency lists.
  - **Account**: Your details, Addresses, Change/Set password, Delete account (or "Deletion requested" while a deletion is pending).
  - **Sign-in methods**: email and password, and linked Google/Apple identities with a Disconnect button (behind a confirmation dialog).
  - **Help and legal**, then **Sign out**.
  - Signed out, the Account group is replaced by a sign-in card.
- `AppearanceView()`: three preview swatches plus a checklist. It writes `@AppStorage(AppearancePreference.storageKey)`.
- `NotificationSettingsView()`: topics (Drops, New products and collections, Promotions, Back in stock), the Email channel, a "Push on this iPhone" row that opens iOS Settings, and Messages → Send read receipts. Each switch saves at once, using the website's rules: a topic writes its email flag only while Email is on, and turning Email off stops every topic.
- `AddressesView()`: honest empty state (Yard has no address-book API; the address is entered at checkout), plus Ship to and Currency.
- `LegalView(page:)`: the website's legal page in a `WKWebView` (non-persistent data store), with a skeleton while loading, an error state with retry, and a toolbar "Open in Safari" button.
- `YouAccountView()` (route `.account`, Settings › Account › Name and email): the name (sign-up rules: 1–80 characters, no control characters or `<>`; saved at once with `PATCH /api/account?as=shopper`, then `session.refresh()`), and the email: current address (+ Verified), "Change email" → new email + current password (accounts with a password) → `POST /api/account/email?as=shopper` → pending card ("We sent a link to …", expiry) with Resend link / Use a different email / Cancel change (`DELETE /api/account/email?as=shopper`). Accounts without a password get 403 `fields.reauth = "required"`: the form shows "Confirm with Google/Apple" (the account's linked providers), which runs the provider in the in-app web sheet with `mode: "reauth"` (`POST /api/auth/oauth/{p}/start`; the sheet carries this session's cookies) and then sends the link again. The account is re-read (`GET /api/account?as=shopper`) whenever the app returns to the foreground; when the email changed, the session is refreshed too. `/auth/change-email?token=` links that reach the app are confirmed with `POST /api/auth/change-email/confirm` (`YouEmailChangeLink`); normally they open on the website.
- Help: You › Help and Settings › Help and legal have "Message Yard Support" (the native thread, `.support`) and "Help centre" (the website).
- Sheets: `YouRegionSheet`, `YouChangePasswordSheet`, `YouDeleteAccountSheet`. Deleting the account uses a modal confirmation, as the site rule requires: type DELETE, plus the password when re-auth is needed.
- Help (`https://yardstore.space/support`), Sell on Yard (`/sell`) and "Connect on the web" (`/you/settings`) open in `SFSafariViewController`.

## Endpoints
- `GET /api/notifications/preferences?as=shopper`, `PATCH` the same path with `{ email?, inApp? }`. The categories are `drops`, `price_drops`, `back_in_stock` and `brand_news`.
- `GET /api/inbox/settings` and `PATCH /api/inbox/settings` with `{ readReceipts }`.
- `GET /api/auth/security?as=shopper`. Returns hasPassword, identities, providers, reauthAgeSec, deletion and demo.
- `DELETE /api/auth/identities/{id}?as=shopper`
- `POST /api/auth/password/change?as=shopper` with `{ currentPassword?, newPassword }`. Server fields are mapped onto the form fields.
- `POST /api/auth/reauth?as=shopper` with `{ password }`, then `POST /api/auth/account/delete` with `{ confirm: "DELETE" }`. After that the app calls `session.refresh()` and `router.popToRoot(.you)`.
- Sign out: `SessionStore.signOut()`.

## Private helpers (YouSupport.swift)
- `YouMarkets`: a copy of `src/config/markets.ts`.
- `YouRegion`: stores the ship-to country in UserDefaults under `yard.shipTo`, and `yard.currencyChosen`. Choosing a country also switches the currency, unless the shopper picked one (the site's rule). It sets `cart.destinationCountry` and reloads the cart.
- `YouSafariView` / `.youWebPage(_:)`, `YouSettingsGroup`, `YouToggleRow`, `YouTextField`, `YouSkeletonRow`, and the DTOs for `/api/auth/security`.

## Unfinished / notes for the integrator
- **Connecting Google or Apple** is not done in the app. OAuth `link`/`reauth` must finish in the same cookie session, and `ASWebAuthenticationSession`/Safari don't share the app's cookies. The row opens yardstore.space instead. Disconnecting works in the app.
- An OAuth-only account can't re-auth in the app for delete or set-password. The UI tells the shopper to sign out and back in, then act within the window (10 min for delete, 5 min for set-password).
- Root suggestion: at launch, call `YouRegion.restore(into: cart)`, which sets `cart.destinationCountry` from `yard.shipTo`. Today it runs only when Settings or Addresses appear.
- The tiles for Orders, Inbox and Drop reminders show no counts. No cheap count endpoint was wired.
- "Interests" (from the site's settings) is not in this folder. It belongs with Auth/Welcome.

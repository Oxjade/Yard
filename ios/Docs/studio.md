# Studio in the app (iOS)

Contract: `docs/APP.md` › "Studio in the app" (server f235247). Code: `Yard/Features/Studio/`.

## Flow
- **Role screen** (`RoleChoiceView`, full screen from `RootView`): shown for a signed-in account with no
  recorded choice (per account, on this device) and no brands. Shop → straight in (Welcome is skipped).
  Sell → the short application. Demo accounts never see it.
- **Application** (`SellerApplicationView`, rules in `SellerApplicationForm`): name (live label) →
  Instagram/website (scan hint) → category chips (`GET /api/catalog/categories`) → city/country
  (locale default) → slide to submit → confetti. 400 field errors jump to their step; 409 offers the
  website; 422 shows the rule (and "Open Studio" when already approved). Pending shows on You.
- **Studio mode** (`StudioStore`, `StudioRootView`): default into Studio when a brand has
  `canOpenStudio`, remembering the last mode and brand per account. Every Studio call goes through
  `StudioStore.call`, which switches (`POST /api/studio/session/switch`) first and once more on a 401;
  a 401 from the switch itself asks for sign-in. Tabs: Home, Orders, Add (Quick add), Products, Me.
- **Money actions** (cancel/refund): a 403 `fields.reauth` shows an inline re-confirm: password
  (`POST /api/auth/reauth?as=brand`) or the provider via `ASWebAuthenticationSession` on
  `app-start?client=ios&actor=brand` + `app-exchange`, then `POST /api/auth/brand/switch` back to the
  active brand if needed, then the same idempotency key is retried.
- **Push**: `POST /api/devices { platform: "ios", token, appVersion, studio }` on sign-in / new token /
  Studio access change; `DELETE /api/devices` before sign-out. Taps with `scope: "studio"` open
  `link` (or `url`) via `StudioLink`, switching brand (`brandId`) and mode. `yard://studio/…` URLs too.

## Gaps
- The token registered is the **APNs** device token. The server sends with FCM only, which needs an FCM
  registration token (Firebase iOS SDK, a third-party package, not allowed here). iOS gets pushes once
  the server sends to APNs directly, or the Firebase SDK is added and its token sent instead. Also needed:
  the Push Notifications capability (`aps-environment` entitlement) and an APNs key (in Firebase if FCM).
- Sign-in still uses the in-app WKWebView (`AuthWebSheet`), which Google refuses. The PKCE +
  `ASWebAuthenticationSession` helper used for re-confirmation (`StudioProviderReauth`) is the pattern
  to move sign-in to `app-start?client=ios` (then `isNew` from `app-exchange` can drive the role screen).
- Payout account setup and payout requests stay on the website (v1).
- Inbox: text replies only (no photo replies yet).

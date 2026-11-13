# Auth (features/auth)

Mirrors `ios/Yard/Features/Auth` file for file: AuthModels, AuthService (`AuthAPI`, `AuthEmailLinks`),
AuthWebSheet (`AuthCookieBridge`, `AuthWebSheet`), AuthComponents (fields, links, Google mark,
social pill, `AuthOnboarding`), SignInModel / SignInView, WelcomeModel / WelcomeView.

## Screens
- **SignInView()** — logo, "Sign in or join", one "Continue with …" per provider from
  GET /api/auth/providers (Auth0 Google fallback if that call fails), demo shopper button only when
  the server allows it, email + password card (eye toggle), "Email me a sign-in link",
  "Forgot password?", Create account mode → "Check your email" panel. Server sentences shown as-is;
  server `fields` go under their fields. Already signed in → "You're signed in" with Continue / Sign out.
  On success: `session.didSignIn()`, confirm a shopper exists, then Welcome (first time on this
  device) or close (dismiss sheet / pop).
- **Shop or sell (new, from the website's /auth/complete)** — after a successful *social* sign-in
  (non-demo shopper) the screen shows "What brings you to Yard?": **I’m here to shop** → Welcome
  (not onboarded) or close; **I want to sell on Yard** → `Config.webUrl("/studio/onboarding")`
  (https://yardstore.space/studio/onboarding) in a Custom Tab; the panel stays so they can still
  pick "shop" afterwards. Note: the Custom Tab uses the browser's cookies, so the seller application
  asks them to sign in again on the web.
- **WelcomeView()** — 3 skippable steps (categories, looks, brands to follow), progress bar,
  Back / Skip / Continue bar, "Skip setup". Signed out → "Make it yours" sign-in empty state.
  Android back steps back through the steps.
- **AuthWebSheet** — full-screen dialog with the WebView for social sign-in.

## Tablets & large screens
- **SignInView**: the form column is capped at a reading width (`signInReadingWidth`: full width on
  phones, `min(contentMaxWidth, 560dp)` on Medium/Expanded) and centred with `AdaptiveContent`;
  background and top bar stay full-bleed. As a route sheet it already sits in the ≤ 560dp dialog.
- **WelcomeView**: steps in `AdaptiveContent` (720/960dp), the bottom bar's buttons capped the same
  way (its surface stays full width); suggested brands two per row on `isWide` (`welcomeBrandColumns`).
- **AuthWebSheet**: stays full-screen (provider pages are responsive).
- `@YardTabletPreviews` on SignIn and Welcome.

## State
- Sign-in name, email, mode and the "check your email" address live in the ViewModel's
  `SavedStateHandle` (survive process death); the password never does. Welcome picks
  (categories / looks), step and the follow baseline use `rememberSaveable`.
- Touch targets: password eye, text links and "Skip setup" are ≥ 48dp.

## Endpoints
GET /api/auth/providers · POST /api/auth/sign-in · POST /api/auth/sign-up · POST /api/auth/magic-link ·
POST /api/auth/password/forgot · POST /api/auth/oauth/{provider}/start · POST /api/auth/demo ·
GET /api/session (SessionStore) · GET /api/catalog/categories · GET /api/catalog/brands ·
POST/DELETE /api/follows (FollowStore). Helpers (not wired): POST /api/auth/magic-link/consume,
POST /api/auth/verify-email/confirm (`AuthEmailLinks`).

## Social sign-in: WebView + cookie copy (same reasoning as iOS)
POST /start from the app (binding cookie `yard_oauth` lands in OkHttp's `PersistentCookieJar`,
reached via `APIClient.shared.http.cookieJar`) → clear `android.webkit.CookieManager`, copy the
app's API-host cookies in → load the provider URL → stop at `https://<host>/auth/complete?result=`
(`shouldOverrideUrlLoading`, with `onPageStarted` as a fallback) → read the host's cookies from
CookieManager (retry 5 × 300 ms for `yard_s` / `__Host-yard_s`) and save them into the OkHttp jar
(stale `yard_oauth` removed) → `session.didSignIn()`. CookieManager is process-wide, so cookies and
web storage are wiped before and after each flow (iOS: non-persistent data store).
CookieManager only exposes name=value: imported cookies keep the attributes of an existing app
cookie with the same name, else host-only, Path=/, Secure (https), HttpOnly, 30-day expiry (the
session's idle window; the server re-sets the real expiry on its daily renewal).

**Risk to check on device (bigger than on iOS):** Google rejects OAuth in Android WebViews
(`403 disallowed_useragent`, detected from the `; wv` user-agent token). If Auth0's Google page
shows that, the fix is server-side: a native hand-off (`/start` accepting a `client: "android"`
flag and `/auth/complete` redirecting to `yard://auth/complete?code=…` that the app exchanges for
the session cookie), after which a Custom Tab can be used. That is a website change (staging first).
The user agent is not spoofed.

## Local state
SharedPreferences `yard` (`Config.preferences`), same keys as iOS `@AppStorage`: `yard.onboarded`
(Boolean), `yard.interests`, `yard.aesthetics` (comma-separated). Read/write via `AuthOnboarding`.

## Differences from iOS
- Welcome after sign-in replaces the form in place (animated) instead of a NavigationStack push:
  the route sheet's NavHost isn't reachable from features. Finishing Welcome closes sign-in, as on iOS.
- Web sheet: full-screen dialog with × (iOS: sheet with "Cancel"); Android back goes back in web history.
- Apple mark: no Apple logo in Material icons; a phone icon is used (Apple is off on the server today).
- Haptics: LongPress / TextHandleMove feedback for success / selection.

## For the integrator
- `MainActivity.handleLink` should call `AuthEmailLinks.canHandle(url)` / `handle(url, session)`
  before `router.open(url)` so `/auth/magic` and `/auth/verify` links finish sign-in in the app.
- Password reset finishes on the website (`/auth/reset`).

## Tests
`app/src/test/java/space/yardstore/app/features/auth/`: AuthModelsTest (8), SignInModelTest (13,
MockWebServer), WelcomeModelTest (9, MockWebServer), AuthCookieBridgeTest (3), AuthAdaptiveTest (6:
reading width, brand columns, picks saver, SavedStateHandle restore without password). `AuthAPI.clientOverride`
/ `baseOverride` and `WelcomeModel(api, base)` are the test hooks.

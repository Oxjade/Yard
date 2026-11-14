# Auth (features/auth)

Mirrors `ios/Yard/Features/Auth` file for file: AuthModels, AuthService (`AuthAPI`, `AuthEmailLinks`),
AuthAppHandoff (Android: Custom Tab sign-in hand-off, replaces the WebView sheet), AuthComponents (fields, links, Google mark,
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
- Social sign-in opens a **Custom Tab** (no in-app WebView); see `Docs/connect.md`.

## Tablets & large screens
- **SignInView**: the form column is capped at a reading width (`signInReadingWidth`: full width on
  phones, `min(contentMaxWidth, 560dp)` on Medium/Expanded) and centred with `AdaptiveContent`;
  background and top bar stay full-bleed. As a route sheet it already sits in the ≤ 560dp dialog.
- **WelcomeView**: steps in `AdaptiveContent` (720/960dp), the bottom bar's buttons capped the same
  way (its surface stays full width); suggested brands two per row on `isWide` (`welcomeBrandColumns`).
- `@YardTabletPreviews` on SignIn and Welcome.

## State
- Sign-in name, email, mode and the "check your email" address live in the ViewModel's
  `SavedStateHandle` (survive process death); the password never does. Welcome picks
  (categories / looks), step and the follow baseline use `rememberSaveable`.
- Touch targets: password eye, text links and "Skip setup" are ≥ 48dp.

## Endpoints
GET /api/auth/providers · POST /api/auth/sign-in · POST /api/auth/sign-up · POST /api/auth/magic-link ·
POST /api/auth/password/forgot · GET /api/auth/oauth/{provider}/app-start (in the Custom Tab) ·
POST /api/auth/oauth/app-exchange · POST /api/auth/demo ·
GET /api/session (SessionStore) · GET /api/catalog/categories · GET /api/catalog/brands ·
POST/DELETE /api/follows (FollowStore). Helpers (not wired): POST /api/auth/magic-link/consume,
POST /api/auth/verify-email/confirm (`AuthEmailLinks`).

## Social sign-in: Custom Tab + hand-off code
Google rejects OAuth in WebViews, so every social button (google / apple / auth0 connections) opens
`/api/auth/oauth/{provider}/app-start?client=android&challenge=…` in a Custom Tab with a PKCE
challenge; the website redirects to `yard://auth/complete?code=…`, `MainActivity` hands it to
`AuthAppHandoff.complete`, which POSTs `/api/auth/oauth/app-exchange { code, verifier }` (session
cookie into the app's jar), refreshes the session and publishes the outcome that `SignInView`
finishes (shop-or-sell, Welcome, close; errors in the website's words). The verifier survives
process death (SharedPreferences, 10 min). Full flow and requests: `Docs/connect.md`.

## Local state
SharedPreferences `yard` (`Config.preferences`), same keys as iOS `@AppStorage`: `yard.onboarded`
(Boolean), `yard.interests`, `yard.aesthetics` (comma-separated). Read/write via `AuthOnboarding`.

## Differences from iOS
- Welcome after sign-in replaces the form in place (animated) instead of a NavigationStack push:
  the route sheet's NavHost isn't reachable from features. Finishing Welcome closes sign-in, as on iOS.
- Social sign-in: Custom Tab + `yard://auth/complete` hand-off (iOS still uses its web sheet until it moves to the same endpoints).
- Apple mark: no Apple logo in Material icons; a phone icon is used (Apple is off on the server today).
- MFA (admin-only accounts): no MFA screens, as with the password form; the hand-off says to sign in on the website.
- Haptics: LongPress / TextHandleMove feedback for success / selection.

## For the integrator
- `MainActivity.handleLink` should call `AuthEmailLinks.canHandle(url)` / `handle(url, session)`
  before `router.open(url)` so `/auth/magic` and `/auth/verify` links finish sign-in in the app.
- Password reset finishes on the website (`/auth/reset`).

## Tests
`app/src/test/java/space/yardstore/app/features/auth/`: AuthModelsTest (8), SignInModelTest (12,
MockWebServer), AuthAppHandoffTest (13: PKCE vector, app-start URL, link parsing, exchange), WelcomeModelTest (9, MockWebServer), AuthAdaptiveTest (6:
reading width, brand columns, picks saver, SavedStateHandle restore without password). `AuthAPI.clientOverride`
/ `baseOverride` and `WelcomeModel(api, base)` are the test hooks.

# Auth (Features/Auth)

## Screens
- **SignInView()** — logo, "Sign in or join", one "Continue with …" button per provider the server
  lists (Google via Auth0 by default), demo shopper button only when the server allows it, email +
  password card (password eye), "Email me a sign-in link", "Forgot password?", Create account mode
  (name/email/new password → "Check your email" panel). Server sentences shown as-is; server
  `fields` go under their fields. Already signed in → "You're signed in" with Continue / Sign out.
  On success: `await session.didSignIn()`, confirm `session.isSignedIn`, then Welcome (first time on
  this device) or `router.dismissSheet()` (or `dismiss()` when pushed).
- **WelcomeView()** — the website's /welcome: 3 skippable steps (categories, looks, brands to follow),
  progress bar, Back / Skip / Continue bar, "Skip setup". Signed out → sign-in empty state.
- AuthWebSheet — in-app web view for social sign-in.

## Endpoints
GET /api/auth/providers · POST /api/auth/sign-in · POST /api/auth/sign-up · POST /api/auth/magic-link ·
POST /api/auth/password/forgot · POST /api/auth/oauth/{provider}/start · POST /api/auth/demo ·
GET /api/session (via SessionStore) · GET /api/catalog/categories · GET /api/catalog/brands ·
POST/DELETE /api/follows (via FollowStore). Helpers (not wired): POST /api/auth/magic-link/consume,
POST /api/auth/verify-email/confirm.

## Social sign-in: why a WKWebView, not ASWebAuthenticationSession
The server binds each OAuth round trip to the browser that started it (`yard_oauth` cookie set on
the `/start` response, checked in the callback) and sets `yard_s` on the callback response.
ASWebAuthenticationSession uses Safari's cookie jar: the app can't put the binding cookie in nor
read the session cookie out, so the callback answers `invalid_state` and the app never signs in.
So the flow is: POST /start from the app (cookie lands in `HTTPCookieStorage.shared`) → copy the
app's cookies into a non-persistent `WKWebsiteDataStore` → load the provider URL → stop at
`https://<host>/auth/complete?result=` → copy the web view's host cookies back into
`HTTPCookieStorage.shared` → `session.didSignIn()`.

**Risk to check on device:** Google refuses OAuth inside embedded web views
(`403 disallowed_useragent`). If Auth0's Google page shows that, the real fix is server-side: a
native hand-off (e.g. `/start` accepting a `client: "ios"` flag and `/auth/complete` redirecting to
`yard://auth/complete?code=…` that the app exchanges for the session cookie), after which
ASWebAuthenticationSession can be used. That is a website change (staging first).

## Local state
`@AppStorage` keys in `AuthOnboarding`: `yard.onboarded` (Bool), `yard.interests`,
`yard.aesthetics` (comma-separated slugs). The website keeps these per browser too (no server API).
Home/You may read them (e.g. order Discover, an "Edit interests" row pushing `.welcome`).

## Unfinished / for the integrator
- Email links (`/auth/magic?token=`, `/auth/verify?token=`) open Safari: the Router sends `/auth/*`
  out of the app. `AuthEmailLinks.canHandle(_:)` / `handle(_:session:)` are ready to call from
  `onOpenURL` (needs universal links / AASA for yardstore.space to reach the app).
- Password reset finishes on the website (`/auth/reset`).
- Foundation note: `YardPillButtonStyle(style:)` is not callable outside YardButton.swift (its
  private `@Environment` property makes the memberwise init file-private). Auth uses its own
  `AuthPillButtonStyle`; giving `YardPillButtonStyle` an explicit `init(style:)` would fix it for all.

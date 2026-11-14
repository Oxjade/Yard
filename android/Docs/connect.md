# Connecting the app to the website: sign-in hand-off, push, app links, release signing

What the Android app needs from the website (`yardstore.space`) and from the owner. iOS will use the
same endpoints later with `client=ios`.

## 1. Social sign-in (Google / Apple / Auth0) — Custom Tab + hand-off code

Google refuses OAuth inside an embedded WebView, so the provider runs in a **Custom Tab**. A Custom
Tab has the browser's cookies, not the app's (OkHttp `PersistentCookieJar`), so the website hands the
sign-in back with a single-use code that the app exchanges itself. Code: `features/auth/AuthAppHandoff.kt`.

1. Tap "Continue with …" → `SignInModel.startSocial` → `AuthAppHandoff.begin`:
   - verifier = 32 random bytes, base64url without padding (43 chars); challenge =
     base64url(SHA-256(verifier)) (43 chars) (`AuthPkce`).
   - the verifier, button and time are kept in SharedPreferences `yard`
     (`yard.auth.handoff.*`), so they survive the process being killed while the tab is open;
     valid for 10 minutes; a new tap replaces it; used once.
   - opens in a Custom Tab:
     `GET https://yardstore.space/api/auth/oauth/{google|apple|auth0}/app-start?client=android&challenge=<43>&mode=signin&actor=shopper[&connection=<auth0 connection>]`
2. The website runs the provider and its callback redirects the tab to
   `yard://auth/complete?code=<code>&result=signed_in&provider=<p>&mode=signin&actor=shopper`
   (failure: `yard://auth/complete?result=<cancelled|invalid_state|error|not_configured|…>&provider=<p>`).
3. `MainActivity` (onCreate and onNewIntent) → `AppLinkRouting.classify` returns `AuthHandoff`
   for `yard://auth/complete` (checked first; never handed to `Router.open`) →
   `AuthAppHandoff.complete(url, session)` on the app scope. If no sign-in screen is showing (process
   restarted), it presents `Route.SignIn` to finish on.
4. Exchange, from the app's own HTTP client (so the cookie lands in the app's jar):
   ```
   POST /api/auth/oauth/app-exchange
   Origin: https://yardstore.space · X-Yard-Client: 1 · Content-Type: application/json
   {"code":"<code>","verifier":"<verifier>"}
   ```
   - 200 `{ "result": "signed_in", "isNew": true|false, … }` + `Set-Cookie: yard_s=…` → the app then
     calls **GET /api/session** (it ignores any session fields in the exchange body).
   - 200 `{ "status": "mfa_required" | "mfa_enrol_required", … }` (the password sign-in's MFA shape)
     → "This account needs a second sign-in step. Sign in on the Yard website to continue." (the app
     has no MFA screens; MFA is admin-only today, as with the password form).
   - 400 (`invalid_code`: unknown, used, expired, verifier mismatch) → "This sign-in link expired or
     could not be verified. Start again."
   - A `result` other than `signed_in`, or a link with no code, shows the website's sentence for it
     (`AuthOAuthResult`, same map as `auth-oauth-completion.tsx`).
5. `SignInView` picks up `AuthAppHandoff.outcome` and continues exactly like before: confirms a
   shopper is in the session, then "What brings you to Yard?" (shop → Welcome or close; sell →
   `/studio/onboarding` in a Custom Tab), Welcome on first sign-in, or close. While the code is being
   exchanged the tapped button shows its spinner (`AuthAppHandoff.exchangingKey`).

The WebView sign-in (`AuthWebSheet`, cookie copying) is gone.

## 2. Push notifications (Firebase Cloud Messaging)

Code: `features/notifications/NotificationsRemotePush.kt` (+ `YardPushCenter` in NotificationsPush.kt).

- Firebase starts only if `android/app/google-services.json` was present at build time (the
  `com.google.gms.google-services` plugin is applied only then). Without it the app builds and runs;
  every Firebase call is skipped (`FirebaseApp.getApps(context).isEmpty()`).
- **Register** (after every sign-in and on app start while signed in — `YardPushNotifications()`):
  ```
  POST /api/devices   {"platform":"android","token":"<fcm token>","appVersion":"<versionName>"}
  ```
  `YardMessagingService.onNewToken` stores the token and posts it too (a 401 while signed out is ignored).
- **Unregister**, before sign-out, while the session still works (`SessionStore.addBeforeSignOutListener`,
  max 3 s, failures ignored, never blocks sign-out):
  ```
  DELETE /api/devices   {"token":"<fcm token>"}
  ```
- **Showing**: channel `yard_updates` ("Updates", high importance), small icon `ic_stat_yard`, colour
  `yard_acid`, title/body from the message, tag = `data.id` (a repeat replaces it). In the foreground
  `onMessageReceived` builds it (`YardPushMessage.from` → `YardPushNotifier`); in the background the
  system shows it using the manifest defaults (same channel, icon, colour).
- **Tap**: opens `MainActivity` with `https://<site><data.url>` and `YardPushCenter.EXTRA_HREF`; a
  background tap arrives as the launcher intent with FCM extras (`google.message_id`, `url`). Either
  way `AppLinkRouting` → `YardPushCenter.handleTap(href)` → the existing routing (orders / inbox in
  You, others in Home). Only same-origin paths (`/…`, not `//…`) are opened; otherwise the list.
- Permission (Android 13+): unchanged — the existing soft prompt after the first follow or a drop
  reminder, and You › Notifications. No new prompt.

Payload the website sends (FCM HTTP v1):
```json
{ "token": "…", "notification": { "title": "…", "body": "…" },
  "data": { "url": "/you/orders/ord_1", "kind": "order_update", "id": "ntf_…" },
  "android": { "priority": "high", "notification": { "channel_id": "yard_updates", "color": "#F5FF00", "tag": "ntf_…" } } }
```

## 3. App links

The manifest declares `https://yardstore.space/…` links with `autoVerify`. Android verifies them
against `https://yardstore.space/.well-known/assetlinks.json` (served by the website from
`ANDROID_CERT_SHA256`). Until that has the right fingerprint, links open in the browser; `yard://`
links always work.

## 4. Release signing

`app/build.gradle.kts` signs `release` with `android/keystore.properties`
(`storeFile`, `storePassword`, `keyAlias`, `keyPassword`; a relative `storeFile` is relative to
`android/`) or, if that file is missing/incomplete, the env vars `YARD_KEYSTORE_FILE`,
`YARD_KEYSTORE_PASSWORD`, `YARD_KEY_ALIAS`, `YARD_KEY_PASSWORD`. Neither → the release build is
unsigned (still builds). `keystore.properties`, `*.jks`, `*.keystore` and `app/google-services.json`
are git-ignored.

## Owner setup (once)

1. **Firebase**: create a project at console.firebase.google.com → add an Android app with package
   `space.yardstore.app` → download `google-services.json` → put it at `android/app/google-services.json`
   on the machine that builds the app (not in git). Rebuild.
2. **Server push key**: Firebase console → Project settings → Service accounts → "Generate new
   private key" → copy the JSON to the VPS, e.g. `/etc/yard/fcm-service-account.json`
   (`chmod 600`, owned by the app user) → set `FCM_SERVICE_ACCOUNT_FILE=/etc/yard/fcm-service-account.json`
   in the website's environment → restart. Unset = push off (no error).
3. **Upload keystore** (keep it and its passwords safe — losing it means you can't update the app):
   ```
   keytool -genkeypair -v -keystore yard-release.jks -alias yard -keyalg RSA -keysize 4096 -validity 10000
   ```
   Put `yard-release.jks` in `android/` (or anywhere) and create `android/keystore.properties`:
   ```
   storeFile=yard-release.jks
   storePassword=…
   keyAlias=yard
   keyPassword=…
   ```
4. **SHA-256 for app links**:
   ```
   keytool -list -v -keystore android/yard-release.jks -alias yard | grep SHA256
   ```
   If the app is distributed through Google Play with Play App Signing, also add the **app signing
   key** SHA-256 from Play Console → Setup → App integrity. Set them on the website, comma-separated,
   uppercase colon form: `ANDROID_CERT_SHA256=AA:BB:…,CC:DD:…`, restart, then check
   `curl https://yardstore.space/.well-known/assetlinks.json`.
5. Build: `./gradlew :app:assembleRelease` (or `bundleRelease` for Play).

## Tests

`features/auth/AuthAppHandoffTest` (PKCE RFC 7636 vector, URL, link parsing, exchange success / 400 /
MFA / errors / expiry), `SignInModelTest.socialStartReturnsAppStartUrlAndOutcomes`,
`app/AppLinkRoutingTest.authHandoffIsNeverARoute`, `features/notifications/NotificationsRemotePushTest`
(message mapping, href safety, background tap extras, exact POST/DELETE /api/devices requests,
DELETE before sign-out).

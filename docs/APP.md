# Yard apps: the server contract

The Android app (`space.yardstore.app`) talks to the same Route Handlers as the website. iOS will
use the same endpoints with `client=ios`. Every write sends `Origin: <site origin>`,
`X-Yard-Client: 1` and `Content-Type: application/json` (src/server/http/csrf.ts).

## Google / Apple / Auth0 sign-in (Custom Tab hand-off)

Google refuses OAuth inside embedded WebViews, so the app signs in through a Custom Tab, whose
cookies are not the app's. Code: `src/server/auth/oauth/app-core.ts` (pure), `flow.ts`, `app-exchange.ts`.

1. The app makes `verifier` = base64url (no padding) of 32 random bytes and
   `challenge` = base64url(sha256(verifier)) (43 characters).
2. It opens a Custom Tab at
   `GET /api/auth/oauth/{google|apple|auth0}/app-start?client=android&challenge=<challenge>&mode=signin&actor=shopper|brand[&connection=<auth0 connection>]`
   - 302 to the provider (same start as `POST …/start`: state row, `yard_oauth` binding cookie on the Custom Tab, PKCE with the provider);
   - 302 `yard://auth/complete?result=not_configured&provider=<p>` when the provider has no keys;
   - 302 `yard://auth/complete?result=error&provider=<p>` for any other refusal (rate limit, unknown connection);
   - 400 JSON for bad parameters (client not android|ios, challenge not `/^[A-Za-z0-9_-]{43}$/`, mode not signin).
3. The provider returns to the usual `/api/auth/oauth/{provider}/callback`. For an app flow it opens
   no session in the Custom Tab; it stores a single-use hand-off code (sha256 only, 120 s) and redirects:
   - success: `yard://auth/complete?code=<43 chars>&result=signed_in&provider=<p>&mode=signin&actor=<a>`
   - failure: `yard://auth/complete?result=<result>&provider=<p>` (no code). Results, as on /auth/complete:
     `cancelled`, `invalid_state`, `error`, `not_configured`, `link_required`, `email_required`,
     `email_unverified`, `no_brand`, `suspended`.
4. The app calls `POST /api/auth/oauth/app-exchange` `{ code, verifier }`:
   - 200 `{ status: "signed_in", result: "signed_in", isNew, provider, actor, profile }` and the session
     cookie (`yard_s` for a shopper, `yard_b` for a brand; `__Host-` prefixed on https). `profile` is the
     narrow profile GET /api/session returns for that actor; call GET /api/session for the full picture.
     `isNew: true` means this sign-in created the account: ask "shop or sell" (shop → home/welcome,
     sell → /studio/onboarding), as the website's /auth/complete does.
   - 400 `{ error: { code: "invalid_code" } }`: unknown, used, expired, or the verifier doesn't match
     (a wrong verifier doesn't spend the code). 403 `csrf` without the headers above. 429 when rate limited.
   - App sign-ins are shopper or brand only, which never need MFA.

## Push notifications

- `POST /api/devices { platform: "android"|"ios", token (≤ 4096), appVersion? }` → 204. Upsert by token.
- `DELETE /api/devices { token }` → 204 (only the caller's token). Call it before signing out.
- Both need the app's shopper session, or a brand member's session; 401 without one; 400 on bad input.

Every in-app notification for a shopper (src/server/notify.ts, src/server/email/inapp.ts) is also
pushed after commit to that shopper's Android devices, in the background (src/server/push). Brand
and admin notifications are not pushed: the app is the shopper app and has no Studio routes. Optional categories follow the in-app preference. The FCM message:

```json
{ "token": "…", "notification": { "title": "…", "body": "…" },
  "data": { "url": "/orders/abc", "kind": "<notification category>", "id": "<notification id>" },
  "android": { "priority": "high", "notification": { "channel_id": "yard_updates", "color": "#F5FF00", "tag": "<notification id>" } } }
```

A token FCM reports as gone (404, UNREGISTERED, INVALID_ARGUMENT) is deleted.

## Environment

- `FCM_SERVICE_ACCOUNT_FILE`: path to the Firebase service-account JSON on the server (e.g.
  `/etc/yard/fcm-service-account.json`, mode 640 root:yard). The project id is read from it. Unset or
  unreadable: pushes are off (logged once). Never commit the key.
- `ANDROID_CERT_SHA256`: comma-separated SHA-256 signing-certificate fingerprints (`AA:BB:…`), served at
  `/.well-known/assetlinks.json` (public, cached 1 h). Unset: `[]`.

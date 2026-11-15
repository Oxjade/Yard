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
   - 302 `yard://auth/complete?result=not_configured&provider=<p>&message=…` when the provider has no keys;
   - 302 `yard://auth/complete?result=rate_limited&provider=<p>&message=…` after too many starts from one address;
   - 302 `yard://auth/complete?result=error&provider=<p>&message=…` for any other refusal (e.g. an unknown connection);
   - 400 JSON for bad parameters (client not android|ios, challenge not `/^[A-Za-z0-9_-]{43}$/`, mode not signin).
3. The provider returns to the usual `/api/auth/oauth/{provider}/callback`. For an app flow it opens
   no session in the Custom Tab; it stores a single-use hand-off code (sha256 only, 120 s) and redirects:
   - success: `yard://auth/complete?code=<43 chars>&result=signed_in&provider=<p>&mode=signin&actor=<a>`
   - failure: `yard://auth/complete?result=<result>&provider=<p>&message=<words>` (no code). `message` is
     the sentence the website shows for that result (URL-encoded). Show the app's own words for the
     results below; for any result the app doesn't know, show `message` as it is (and if it is
     missing, "Sign-in could not be completed."). Never show the raw result code.

     Every sign-in start (website and app, Google and Auth0) shows the provider's account chooser:
     Google gets `prompt=select_account`, Auth0 `prompt=login` (so its session cookie in the Custom
     Tab is never silently reused; see docs/AUTH0.md for the Google chooser behind Auth0). A refused
     sign-in can therefore always be retried with another account.

     | `result` | Words (same as /auth/complete; source: src/lib/auth/oauth-results.ts) |
     |---|---|
     | `cancelled` | Sign-in was cancelled. |
     | `invalid_state` | This sign-in link expired or could not be verified. Start again. |
     | `error` | The provider couldn’t complete sign-in. Try again. |
     | `not_configured` | This sign-in provider isn’t configured on Yard yet. |
     | `rate_limited` | Too many sign-in attempts. Wait a few minutes, then try again. |
     | `link_required` | Sign in with your password before connecting this provider. |
     | `email_required` | The provider didn’t share an email address. Try another sign-in method. |
     | `email_unverified` | That account’s email address isn’t verified with the provider. Verify it there, or sign in another way. |
     | `no_brand` (brand only) | This account doesn’t have a brand workspace yet. Apply to sell on Yard to open one, or sign in with the account your brand uses. |
     | `suspended` | This account is currently unavailable. |
     | `team_account` (shopper) | This is a Yard team account, so it can’t shop. Sign in with a different account. |
     | `account_unavailable` | This Yard account is being deleted or is no longer available. Sign in with a different account. |

     `team_account`: the provider account belongs to a Yard team (admin) account, which can't hold a
     shopper session. `account_unavailable`: the Yard account linked to the identity (or, for a new
     identity, the one with its verified email) is gone or its deletion is pending. Neither links anything: an identity is only linked to an existing account after it
     passed the checks for this sign-in. Each refusal is logged on the server as one line,
     `[yard] auth: <provider> <mode>/<actor> refused: <result> (<reason>)`. When an exception caused
     it (state lookup, code exchange, an unexpected throw), a separate `log.error` diagnostic with the
     stack precedes that line.
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

## Yard Support

Every signed-in shopper has **one** conversation with Yard Support (Yard's own team), and every brand
has one (shared by its team, in Studio). It is stored as an inbox conversation of kind `"support"`
and answered in the inbox's own DTOs, so the app's existing chat screen renders it: the counterpart
(`conversation.brand`) is always Yard Support, and Yard's messages have `side: "support"`. Admins'
personal names are never sent to shoppers or brands. Code: `src/server/support/service.ts`,
`src/lib/api/contracts/support.ts`, routes under `src/app/api/support`.

The thread is created by the first message; until then there is none (`conversation: null`, and the
thread read is 404). It is **not** in `GET /api/inbox/conversations` and the `/api/inbox/conversations/{id}/…`
routes answer 404 for it: show it as a row pinned above the list once
`GET /api/support/conversation` returns one with `lastMessage != null`. Its unread count **is**
included in `GET /api/inbox/unread` and in the `unread.counts` realtime event (the inbox badge).

### Shopper endpoints (shopper session `yard_s`)

All writes send `Origin`, `X-Yard-Client: 1`, `Content-Type: application/json` (see top). Errors are
`{ "error": { "code": string, "message": string, "fields"?: { [field]: string } } }`.

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/support/conversation` | – | 200 `{ "conversation": ConversationSummary \| null }` |
| GET | `/api/support/conversation/messages?before=&after=&limit=` | – | 200 `ThreadDto`; 404 `not_found` before the first message |
| POST | `/api/support/messages` | `SupportSendBody` | 201 `SendResult` (new message); 200 `SendResult` (same `clientId` retried) |
| POST | `/api/support/conversation/read` | `{ "upToSeq": int ≥ 0 }` | 204; 404 before the first message |
| POST | `/api/support/conversation/typing` | – (no body) | 204 always (rate-limited silently: 1 per 2 s) |

Query for the thread read (all optional): `before` (int, older page: messages with `seq < before`),
`after` (int, catch-up: messages with `seq > after`, oldest first), `limit` (1–100, default 50).
Without `after` the newest `limit` messages come back oldest-first, with `hasMore` for older pages.

`SupportSendBody` (strict: unknown fields are 400):

```json
{ "clientId": "8–64 chars, unique per message (UUID)",
  "kind": "text" | "image" | "order",
  "body": "≤ 2000 chars (required for text; optional for image/order)",
  "attachmentIds": ["med_…"],   // kind "image" only, 1–4 ids from POST /api/uploads
  "orderRefId": "mo_…" }         // kind "order" only: one of the shopper's own orders (the id in /you/orders/{id}, GET /api/orders items[].id)
```

- **Order help ("Get help from Yard")**: send `kind: "order"`, `orderRefId: <order id>` and the
  shopper's text in `body`. The message carries an order card (`message.order`) on both sides. The
  website opens `/inbox?support=1&order=<order id>&orderRef=<reference>` with the order as a removable
  chip above the composer; mirror that (chip, then one send).
- **Photos**: only once the thread exists (the first message must be text or an order; a photo
  first is 400 `fields.attachmentIds`). Upload each photo with
  `POST /api/uploads?purpose=inbox_attachment&as=shopper&conversationId=<support conversation id>`
  (multipart, one field `file`, same headers; 201 `{ "media": { "id": "med_…", "src": "/api/media/med_…?as=shopper", "width", "height", … } }`),
  then send `kind: "image"`, `attachmentIds: [media.id, …]` (≤ 4). Display `attachments[].src` with the session cookie.
- A message from the shopper to a resolved conversation reopens it (a system line "Reopened" is added first).
- Resolving and reopening add a system line and make it the conversation's `lastMessage` (`side: "system"`), so the pinned row's preview can be "Yard Support marked this conversation resolved…" or "Reopened". Show it without a "You:" prefix; it never changes `unread`.
- No reactions, no archive/mute/block, and nothing in a support thread can be reported (`POST /api/reports` answers 404 for it).

Status codes: 400 `validation` (`fields.body` "Write a message first.", `fields.attachmentIds`,
`fields.orderRefId` "That order isn't one of yours.", over-length text), 401 `unauthenticated`,
403 `csrf`, 404 `not_found`, 409 `conflict` (a `clientId` used for another message), 413 `too_large`,
429 `rate_limited` (`Retry-After` header; 20 messages/min, 300/day, 5 new threads/hour per shopper).

`ConversationSummary` for a support thread (exact fields):

```json
{ "id": "cv_…", "kind": "support",
  "brand": { "id": "yard_support", "handle": "support", "name": "Yard Support", "mark": { "text": "Y", "style": "yard" }, "verified": true },
  "status": "open" | "resolved",
  "spamState": "none", "locked": false,
  "lastMessage": { "preview": "≤140 chars", "at": "ISO", "side": "customer" | "brand" | "system" | "support" } | null,
  "unread": 0,               // Yard Support messages the shopper hasn't read
  "markedUnread": false, "archived": false, "muted": false,
  "blocked": { "byMe": false, "byThem": false },
  "sample": false, "createdAt": "ISO",
  "interaction": { "canSend": true } }
```

`kind` is new on every summary: `"brand"` for brand conversations (always present from the server;
treat a missing value as `"brand"`). Show Yard's mark (the Yard logo on black) instead of `brand.mark`
when `kind == "support"`, and don't link `brand.handle` to a storefront.

`ThreadDto`: `{ "conversation": ConversationSummary, "messages": MessageDto[], "hasMore": bool, "receipts": { "theirs": { "upToSeq": int, "at": "ISO" | null } | null, "enabled": bool } }`.
`receipts.theirs` is how far Yard Support has read (show "Seen" under the shopper's newest message
with `seq ≤ upToSeq`); `enabled` follows the shopper's read-receipt setting (GET/PATCH `/api/inbox/settings`).

`MessageDto` (as for brand conversations): `{ id, seq: int, conversationId, side: "customer" | "brand" | "system" | "support", kind: "text" | "product" | "order" | "image" | "system", body: string | null, attachments: [{ mediaId, src, width: int | null, height: int | null }], status: "sent", createdAt: ISO, clientId, order?: { orderId, reference, status, placedAt, total: { amount: int (minor units), currency }, itemCount: int } }`.
In a shopper's support thread: `side "customer"` = the shopper (own bubble), `"support"` = Yard Support
(other bubble, Yard mark, name "Yard Support"), `"system"` = a centred line ("Reopened", "Yard Support
marked this conversation resolved. Write again any time to reopen it."). Messages are never held or
removed here, so `status` is always `"sent"`. `SendResult`: `{ "message": MessageDto, "conversation": ConversationSummary }`.

### Realtime (`GET /api/realtime/market`, the shopper's existing SSE stream)

The support thread publishes the inbox's own events on the shopper's channel; match on
`conversationId` / `conversation.id` (and `conversation.kind == "support"` for the pinned row):

| Event | Payload | When |
|---|---|---|
| `message.created` | `{ message: MessageDto, conversation: ConversationSummary }` | any new message or system line (the shopper's own too) |
| `conversation.updated` | `{ conversation: ConversationSummary }` | resolved / reopened, read position changed |
| `read` | `{ conversationId, side: "support", upToSeq, at }` | Yard Support read the shopper's messages (receipts on) |
| `typing` | `{ conversationId, side: "support", until: ISO }` | "Yard Support is typing…" until `until` |
| `unread.counts` | `{ conversations: int }` | the inbox badge (brand conversations + the support thread) |

A replayed event (`partial: true`) carries ids only: refetch `GET /api/support/conversation/messages?after=<last seq>`.

### Notifications and push

A Yard Support reply creates the shopper's normal in-app notification and therefore a push (FCM/APNs
as above): `key "support:<conversation id>"`, `category "new_message"`, title `"Yard Support replied"`,
body `"Open your inbox to read it."`, `href` / push `data.url` **`/inbox?support=1`**, push `data.kind`
`"new_message"`. Open the native Yard Support thread for that URL. Reading the thread
(`POST /api/support/conversation/read`) marks the notification read. New messages from shoppers or
brands notify admins with `support.manage` (category `support_message`, href `/admin/support?case=<id>`;
admin only, never pushed).

### Studio (brand member session `yard_b`; the website only, listed for completeness)

Same shapes under `/api/studio/support/…`: `GET /api/studio/support/conversation`,
`GET /api/studio/support/conversation/messages`, `POST /api/studio/support/messages`
(`{ clientId, kind: "text" | "image", body?, attachmentIds? }`, no orders), `POST …/conversation/read`,
`POST …/conversation/typing`. Any member of the brand may write; the brand's own messages have
`side "brand"`. Replies notify the brand (`href "/studio/support"`, not pushed).

### Admin (Control Center, `support.manage`: roles owner, support, trust & safety)

`GET /api/admin/support?filter=open|resolved|all&mine=1&q=&cursor=` → `{ items: SupportCaseDto[], nextCursor: string | null, counts: { open, resolved, unread, mine } }`
(unread open first), `GET /api/admin/support/{id}` → `{ case }`, `PATCH /api/admin/support/{id}`
`{ status?: "open" | "resolved", assignee?: "me" | null }` → `{ case }`,
`GET|POST /api/admin/support/{id}/messages` (thread as side `"support"`; POST `{ clientId, body }` replies as Yard Support),
`POST /api/admin/support/{id}/read`, `POST /api/admin/support/{id}/typing`. Admin views add
`message.author: { id, name }` to Yard Support messages; party views never carry it.
`GET /api/admin/queues/counts` gains `support` (open conversations with unread messages).

## Account: name and email

The signed-in person's own name and email. A shopper and a brand member are the same `users` row:
use `?as=shopper` in the app (the shopper session `yard_s`). Code: `src/server/auth/account.ts`.

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/account?as=shopper` | – | 200 `{ "account": AccountDto }` |
| PATCH | `/api/account?as=shopper` | `{ "name": string }` | 200 `{ "account": AccountDto }` (saved at once) |
| POST | `/api/account/email?as=shopper` | `{ "email": string, "currentPassword"?: string }` | 200 `{ "account": AccountDto }` with `pendingEmail` set |
| DELETE | `/api/account/email?as=shopper` | – | 200 `{ "account": AccountDto }` with `pendingEmail: null` |
| POST | `/api/auth/change-email/confirm` (public, no session needed) | `{ "token": string }` | 200 `{ "status": "changed", "email": string }` |

`AccountDto`:

```json
{ "name": "Ada Nwosu",
  "email": "ada@example.com",
  "emailVerified": true,
  "hasPassword": true,
  "signInProviders": ["apple", "auth0", "google"],   // linked sign-in identities, sorted; [] when none
  "pendingEmail": { "email": "new@example.com", "expiresAt": "ISO" } | null,
  "demo": false,
  "photo": { "mediaId": "med_…", "src": "/api/media/med_…?as=shopper", "width": 1024, "height": 1024 } | null }
```

`photo` is described under "Profile photo" below.

**Name** (same rules as sign-up): trimmed, 1–80 characters, no control characters and no `<` `>`.
400 `validation` with `fields.name` = "Enter your name." | "Keep it to 80 characters." | "Use letters,
numbers and simple punctuation.". GET `/api/session` returns the new name immediately.

**Email change** (the email only changes once the link sent to the NEW address is opened):
1. `POST /api/account/email?as=shopper` `{ email, currentPassword }`.
   - `hasPassword: true` → `currentPassword` is required: 400 `fields.currentPassword` "Enter your current
     password." / "That isn't your current password.".
   - `hasPassword: false` (Google / Apple / Auth0 / magic-link accounts) → no password; the session must have
     re-confirmed within 10 minutes, else **403 `forbidden` with `fields.reauth = "required"`**. Re-confirm with
     the existing step-up, then retry: `POST /api/auth/reauth?as=shopper` `{ "password" }` for a password account,
     or for a provider account a fresh sign-in: **in the app, run the normal Custom Tab sign-in again**
     (`app-start` + `POST /api/auth/oauth/app-exchange`, above); the new session counts as re-confirmed for
     10 minutes, then retry. (The website uses the OAuth round trip in mode `reauth`; `app-start` only takes
     `mode=signin`.) A 422 from `/api/auth/reauth` names the account's providers in `fields.reauthWith`.
   - 400 `fields.email`: "That's already your email." · "That email can't be used for your account. Try a different
     address." (it belongs to another account; the wording never says whose) · invalid address.
   - 422 `rule` "Demo accounts can't change their email." · 429 `rate_limited` (3 links per new address per hour,
     10 requests per account per hour; `Retry-After`).
   - A new request replaces the previous pending one (its link stops working).
2. The server emails a single-use link (24 hours) to the new address: `https://<site>/auth/change-email?token=<43–64 chars>`.
   The website page POSTs the token to `/api/auth/change-email/confirm` and shows the result; it needs no session,
   so the link works in the phone's browser. If the app claims https links (Android App Links / iOS Universal
   Links), **exclude `/auth/change-email`** so the website handles it — or, if the app opens it, POST the token
   itself to `/api/auth/change-email/confirm` (same headers) and show the result.
   - 200 `{ status: "changed", email }`: the account's email is now `email` (marked verified); the OLD address gets
     an "Your Yard email was changed" notice. Sessions stay signed in; Google / Apple / Auth0 sign-in keeps working.
   - 400 `fields.token`: expired, used, cancelled or superseded link (or the account's email changed meanwhile).
   - 409 `conflict` "That email can't be used for your account. Try a different address." when another account took
     the address in the meantime (the account keeps its old email).
3. `DELETE /api/account/email?as=shopper` cancels a pending change (the sent link stops working).

The app should refetch `GET /api/account?as=shopper` and `GET /api/session` when it returns to the
foreground (the link is usually opened in the browser or mail app): `pendingEmail` becomes `null` and
`email` becomes the new address. All errors use the format above; 401 without a session; 403 `csrf`
without the write headers.

## Profile photo

The signed-in person's photo, shown instead of their initials. One photo per person (a shopper and a
brand member are the same `users` row). No username or bio. Code: `src/server/auth/account-photo.ts`,
`src/app/api/account/photo/route.ts`; files go through the same uploads pipeline as other photos
(`src/server/media`, purpose `account_photo`).

| Method | Path | Body | Success |
|---|---|---|---|
| GET | `/api/account?as=shopper` | – | 200 `{ "account": AccountDto }`; `account.photo` is the photo or `null` |
| POST (or PUT) | `/api/account/photo?as=shopper` | multipart/form-data, one field `file` | 200 `{ "account": AccountDto }` with `photo` set (adds or replaces) |
| DELETE | `/api/account/photo?as=shopper` | – | 200 `{ "account": AccountDto }` with `photo: null` (no-op when there is none) |

Upload headers: `Origin`, `X-Yard-Client: 1`, `Content-Type: multipart/form-data; boundary=…` (not
JSON) and a **`Content-Length`** (the server checks it before reading the body; chunked uploads get
411). Send exactly one part named `file` and nothing else.

**What to send.** Let the person pick a photo (camera or library), show a **square crop** step
(drag + zoom; the website dims everything outside a circle), then upload the cropped square as a
JPEG of at most **1024 × 1024** (quality ~0.9). Re-encoding drops EXIF and GPS on the phone; the
server strips metadata again anyway. HEIC: convert to JPEG on the device (both platforms can decode
it); the server reads only the bytes and accepts JPEG, PNG and WebP.

**Limits.** At most 10 MB; 64–8000 px on each side; JPEG, PNG or WebP by content (the file name and
part type are ignored). Not required to be square, but avatars are drawn round with `object-fit:
cover`, so send a square. 10 uploads per 10 minutes and 30 a day per account; 20 removals per 10
minutes.

**Sizes.** There is one size: the file you uploaded (the media pipeline makes no thumbnails).
`width` / `height` are its pixels. Draw it at any size with aspect-fill.

**Errors** (standard error body):
- 411 `length_required` (no Content-Length) · 413 `too_large` "This file is too large. The limit here is 10 MB."
- 415 `unsupported_type` "Yard couldn't read this as a JPEG, PNG or WebP photo. …"
- 422 `rule`: "This photo is smaller than 64 px on a side. Use a larger one." · "This photo is larger than 8000 px on a side. …"
  · **"Demo accounts can't change their photo."** (upload and delete)
- 400 `validation` `fields.file`: not multipart, no file, several files or extra fields, empty file.
- 403 `restricted` "Uploading is paused on your account until …" (an uploads restriction; removing still works).
- 429 `rate_limited` with `Retry-After` · 401 without a session · 403 `csrf` without the write headers.

**Showing photos.** `src` is a cookie-scoped URL on the site origin: load it with the session cookie
(the same way as inbox attachments). It is private, never public:
- the person themself (`?as=shopper` for the shopper session);
- brands: in Studio the shopper's photo comes in `conversation.customer.photoSrc` (`?as=brand`) for
  shoppers who message or buy from that brand (the server also lets teammates open each other's
  photo; no endpoint lists them yet);
- admins see it in the Control Center (Users).
Anyone else gets 404, and so does a replaced or removed photo for everyone but its owner. A new
photo has a new `mediaId` and `src`, so caches never show the old one; a removed photo can still be
cached for up to 5 minutes (`Cache-Control: private, max-age=300`). If the image fails to load, show
the initials. `GET /api/session` also carries `shopper.photoSrc` (and `brand.photoSrc`,
`admin.photoSrc`) for headers; refetch it after a change.

**Moderation.** Admins with `content.moderate` can remove a photo with a reason (Admin › Users,
decision `remove-account-photo`, audited as `user.photo_removed`). The person gets a notification
(category `content_moderation`): "Yard removed your profile photo" / "Reason: … You can add a new one
in Settings." (href `/you/settings`), also pushed to the app. `photo` is then `null`; they can upload a
new one. The removed file stays (content moderators only, as other removed media) and is not
purged; it goes when the account is deleted. Reports don't cover people or photos (report subjects are messages, conversations, posts,
places and events), so there is no "report photo" yet.

Deleting the account deletes the photo files with it.

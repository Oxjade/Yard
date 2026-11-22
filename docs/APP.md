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

- `POST /api/devices { platform: "android"|"ios", token (≤ 4096), appVersion?, studio? }` → 204. Upsert by token. `studio: true`: the app can open Studio, so this device also gets Studio pushes (see "Studio in the app").
- `DELETE /api/devices { token }` → 204 (only the caller's token). Call it before signing out.
- Both need the app's shopper session, or a brand member's session; 401 without one; 400 on bad input.

Every in-app notification for a shopper (src/server/notify.ts, src/server/email/inapp.ts) is also
pushed after commit to that shopper's Android devices, in the background (src/server/push). Brand
pushes go only to devices registered with `studio: true` (see "Studio in the app › Push for brands");
admin notifications are not pushed. Optional categories follow the in-app preference. The FCM message:

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

## Studio in the app

Approved brand members can run their shop from the app ("Studio mode"), and anyone can apply to
sell from it. Everything below uses the same Route Handlers as the website's Studio, with the same
headers and error body as the rest of this document (writes: `Origin`, `X-Yard-Client: 1`,
`Content-Type: application/json`; errors `{ "error": { "code", "message", "fields"? } }`). Money is
always integer minor units with an ISO currency code. Times are ISO 8601 UTC.

Code: `src/server/studio-app/` (session switch, short application, dashboard, push preferences),
`src/server/push/studio.ts` (Studio pushes), `src/lib/api/contracts/studio-app.ts` (shapes).

**Category-neutral.** Yard is not fashion-only. Never hard-code a category list or apparel words in
the app: render category chips from `GET /api/catalog/categories` (below), call things "products"
(or "pieces"/"items") and "shop"/"brand", and treat "Size" as just one option name among others
(products may have no options at all).

### 1. Sessions: shopper → Studio

The app signs in as a shopper (`yard_s`, see the sections above). A Studio session is a separate
**brand session** (`yard_b`) in the same cookie jar; Studio endpoints (`/api/studio/…`) read only
`yard_b`. Keep both cookies; never send one in place of the other.

**Which brands does this account belong to?** `GET /api/session` now carries `shopper.brands`
(an array, `[]` when none; only on this endpoint, not in sign-in responses):

```json
{ "shopper": { "id": "u_…", "name": "Ada Nwosu", "email": "ada@example.com", "status": "active", "demo": false, "photoSrc": null,
    "brands": [
      { "id": "b_…", "handle": "kachi-studio", "name": "Kachi Studio",
        "logoSrc": "/api/media/med_…" | "/api/media/med_…?as=brand" | null,
        "initials": "KS",
        "role": "owner" | "admin" | "designer" | "fulfilment" | "finance" | "viewer",
        "status": "pending_review" | "approved" | "claimed" | "restricted" | "suspended",
        "canOpenStudio": true }
    ] },
  "brand": BrandProfile | null, "admin": null, "demoAuth": { … }, "sampleData": false }
```

- Only **active** memberships are listed (an invite not yet accepted is not), oldest first. Yard's
  own set-up access to founding brands is never listed.
- `status`: `pending_review` (application waiting for Yard, Studio opens but nothing can go live),
  `approved` (verified), `claimed` (a founding brand Yard set up and the owner claimed; treat as
  approved), `restricted` (Studio opens; publishing and replies are paused), `suspended` (Studio
  does not open: `canOpenStudio: false`).
- `logoSrc`: a public logo loads without a cookie; one ending `?as=brand` loads only once the brand
  session is open. Until then (or when it fails or is null) draw `initials`.
- Show "Studio mode" when at least one brand has `canOpenStudio: true`. With several brands, let the
  person pick one.

**Open Studio (no second login):**

| Method | Path | Session | Body | Success |
|---|---|---|---|---|
| POST | `/api/studio/session/switch` | shopper `yard_s` | `{ "brandId": "b_…" }` | 200 `{ "actor": "brand", "profile": BrandProfile }` + `Set-Cookie: yard_b` (`__Host-yard_b` on https) |

- `BrandProfile` is `GET /api/session`'s `brand`: `{ userId, name, brand: { id, handle, name, reviewStatus: "pending_review"|"verified"|"restricted"|"suspended", logoSrc }, role, permissions: string[], demo, photoSrc }`.
  Use `permissions` to hide actions the role can't take (`orders.fulfil`, `content.publish`,
  `inbox.read`, `inbox.reply`, `inbox.manage`, `shipping.manage`, `locations.manage`, `social.connect`).
  Payouts are visible to roles `owner`, `admin`, `finance` only.
- Errors: 401 without a shopper session; 403 `forbidden` "You aren't a member of this brand." (any
  brand the account isn't an active member of, including made-up ids; no cookie is set); 403
  `suspended` for a suspended brand; 400 `validation` for a bad id; 429 `rate_limited` (30/min).
- It replaces this client's previous brand session. To change brand, call it again with the other
  id. (`POST /api/auth/brand/switch { brandId }` with an open brand session also works and keeps the
  session's re-confirmation time.)
- The brand session lasts 7 days at most (idle 7 days). When any `/api/studio/…` call answers 401,
  call the switch again (silently), then retry once; if the switch itself is 401, the shopper session
  is gone: sign in again.
- **No MFA** for brand sessions (only Yard admin sessions need it). The brand session inherits the
  shopper session's sign-in method and its *last re-confirmation time*; it never counts as a fresh
  re-confirmation by itself.
- **Re-confirm for money actions.** Paid-order cancels, refunds, return receipts and the payout
  account answer 403 with `fields.reauth = "required"` and `fields.reauthWith` (`"password"`, or the
  linked providers such as `"google"`, `"apple,google"`, `"auth0:google-oauth2"`) when the brand
  session hasn't re-confirmed in the last 5 minutes. Password accounts: `POST /api/auth/reauth?as=brand { "password" }` → 200 `{ ok: true, method }`, then retry.
  Provider accounts: run the Custom Tab sign-in with `actor=brand`
  (`GET /api/auth/oauth/{provider}/app-start?client=…&challenge=…&mode=signin&actor=brand`, then
  `POST /api/auth/oauth/app-exchange`); the new `yard_b` counts as re-confirmed for 5 minutes. Then retry.
- **Leaving Studio** keeps the shopper signed in: `POST /api/auth/sign-out?actor=brand` → 200 `{ ok: true }`.
  Signing out of the app: call `DELETE /api/devices`, then `POST /api/auth/sign-out?actor=brand` and `?actor=shopper`.
- Realtime for Studio: `GET /api/realtime/studio` (SSE, brand session) carries the website's Studio
  events (`unread.counts`, `message.created`, `order.updated`, `payout.updated`, `notification.created`).

### 2. Shop or sell: the role screen and the short application

After a sign-up (`isNew: true` from app-exchange, or a new password account), show "Shop" / "Sell".
Shop goes home. Sell opens the short application, unless `shopper.brands` is non-empty (then open
Studio) or `GET /api/studio/apply` already has one waiting.

**Categories** (public, cached 5 min; never hard-code them):
`GET /api/catalog/categories` → `{ "categories": [ { "slug", "name", "description", "imagePath": string | null, "subcategories": string[], "productCount", "brandCount" } ] }`.
Render one chip per category in this order; send its `slug`.

| Method | Path | Session | Body | Success |
|---|---|---|---|---|
| GET | `/api/studio/apply` | shopper | – | 200 `{ "application": StudioApplicationDto \| null }` (the latest, short or website) |
| POST | `/api/studio/apply` | shopper | `StudioApplyBody` | 201 `StudioApplyResult` (submitted now); 200 (one was already waiting: unchanged) |

`StudioApplyBody` (strict: unknown fields are 400):

```json
{ "brandName": "2–40 chars (the shop's name)",
  "instagram": "@handle, handle or an instagram.com link (optional)",
  "website": "yourshop.com or https://… (optional)",
  "category": "<slug from /api/catalog/categories>",
  "city": "2–80 chars",
  "country": "NG" | "GH" | "KE" | "ZA" | "GB" | "FR" | "DE" | "US" | "MX" | "JP" | "KR",
  "about": "optional, ≤ 160 chars: what you sell, in one line" }
```

At least one of `instagram` or `website` is required. The currency follows the country (NGN, GHS,
KES, ZAR, GBP, EUR, USD, MXN, JPY, KRW). The shop address (`handle`) is made from the name (the
first free one: `kachi-studio`, `kachi-studio-studio`, `kachi-studio-official`, …); it can be changed
in Studio later.

```json
// StudioApplyResult
{ "application": StudioApplicationDto,
  "websiteScan": { "status": "started", "importId": "imp_…" } | { "status": "skipped", "reason": "…" } | null }

// StudioApplicationDto
{ "id": "onb_…", "status": "draft" | "submitted" | "approved" | "rejected",
  "source": "app" | "studio",                  // studio = the website's full application
  "brand": { "id": "b_…", "handle": "…", "name": "…" } | null,
  "submittedAt": "ISO" | null, "reviewedAt": "ISO" | null,
  "reviewNote": "what to change" | null }      // only after a rejection
```

- What it does: creates the shop in `pending_review` with the applicant as **owner** and submits the
  application; it appears at once in Admin › Brands like a website application (with the Instagram,
  website and "Short application from the app"). From then on `shopper.brands` lists it as
  `pending_review` and `POST /api/studio/session/switch` opens its Studio (nothing goes live until
  Yard approves).
- With a `website`, Yard starts a background scan of the site with its importer so the reviewer
  finds the products ready (Admin › the brand › Import from website). Nothing is created, suggested
  or published by the scan itself. `websiteScan` says whether it started; a skipped scan never fails
  the application.
- After a rejection (`status: "rejected"`, show `reviewNote`), POST again to resubmit on the same shop.
- Errors: 400 `validation` with `fields.brandName | instagram | website | category | city | country`
  ("Add your Instagram or your website, so Yard can see what you sell.", "Enter an Instagram handle like @yourshop.",
  "Choose one of Yard's categories.", "Choose a country Yard sells in."); 409 `conflict` "You have an
  application in progress on the website. Finish it there, or clear it, then apply here."; 422 `rule`
  ("Your shop is already approved. Open Studio to manage it.", "Your shop is on hold by Yard…",
  "Demo accounts can't apply to sell on Yard."); 401; 429 (10/min, 20/day).
- **Approval:** the applicant gets the email "Your shop is ready" (button "Open Studio") and a push
  (`kind "studio.approved"`, below), and `shopper.brands[].status` becomes `approved`.

### 3. Studio API for the app's v1 screens

All with the brand session `yard_b`, for the **active brand** of that session only (another brand's
id is 404). "Role" lists who may call it (others get 403 `forbidden`).

#### Home

`GET /api/studio/dashboard?days=7|30` (default 7; any member) → `StudioDashboardDto`:

```json
{ "brand": { "id", "handle", "name", "currency": "NGN", "timeZone": "Africa/Lagos" },
  "sales": { "today": SalesWindow, "week": SalesWindow, "month": SalesWindow },
  "series": { "days": 7, "points": [ { "date": "2026-11-15", "orders": 1, "grossMinor": 300000, "netMinor": 300000 } ] },
  "toShip": { "total": 3, "paid": 2, "processing": 1 },
  "lowStock": { "variants": 2, "products": 1, "threshold": 3 },
  "unreadMessages": 4 | null,
  "websitePieces": 5,
  "topProducts": [ { "productId", "title", "currency", "units", "revenueMinor", "image": { "src", "alt" } | null } ],
  "storeViews": { "today": 12, "week": 80, "month": 310 } }
// SalesWindow = { "orders": int, "grossMinor": int, "refundedMinor": int, "netMinor": int }
```

- Paid (captured) orders only, in the brand's currency and **its own calendar** (`timeZone`): today
  is the brand's today; `week` = the last 7 days including today; `month` = the last 30 days
  including today. `series.points` has exactly `days` points, oldest first, today last, zeros
  included. `topProducts` (≤ 5) by units kept in the last `days` days.
- `toShip`: orders Paid or Processing (link to the Orders list, `fulfilment=unfulfilled|processing`).
  `lowStock`: active variants with available stock ≤ `threshold` (link to Products `lowStock=1`).
  `unreadMessages` is null when the role can't read the inbox. `websitePieces`: "New from your
  website" waiting. `storeViews`: storefront views Yard Charts counted (bots and fraud excluded).
- The website's own overview (`GET /api/studio/overview?days=7|30|90`, `StudioOverviewDto` in
  `src/lib/api/contracts/orders.ts`) still works and adds `recentOrders` (the last six orders).

#### Orders

| Method | Path | Role | Body | Success |
|---|---|---|---|---|
| GET | `/api/studio/orders?fulfilment=&payment=&returns=&q=&before=&limit=` | any | – | 200 `{ items: OrderSummaryDto[], nextCursor: string \| null }` newest first |
| GET | `/api/studio/orders/{id}` | any | – | 200 `{ order: OrderDetailDto }` |
| POST | `/api/studio/orders/{id}/processing` | `orders.fulfil` | – | 201 `{ alreadyProcessing: false, order }`; 200 when already processing |
| POST | `/api/studio/orders/{id}/shipment` | `orders.fulfil` | `{ status, carrier?, trackingNumber?, occurredAt?, note? }` | 201 `{ event, estimate, delivery }` |
| POST | `/api/studio/orders/{id}/cancel` | `orders.fulfil` | `{ reason (3–200), restock = true, idempotencyKey }` | 200 `{ …, order }` |
| POST | `/api/studio/orders/{id}/refunds` | `orders.fulfil` + role owner/admin | `{ amountMinor, reason (3–200), idempotencyKey }` | 201 `{ refundId, status, duplicate: false, order }`; 200 with `duplicate: true` on a retried key |

- Status tabs (query values): **To ship** `fulfilment=unfulfilled` (includes Paid) and
  `fulfilment=processing`; **Shipped** `fulfilment=shipped`; **Delivered** `fulfilment=delivered`;
  **Cancelled** `fulfilment=cancelled`; **Returns** `returns=open`. Also `payment=pending|paid|failed|partially_refunded|refunded`
  and `q` (order reference contains). Page with `before=<nextCursor>`; `limit` 1–100 (30).
- `OrderSummaryDto`: `{ id, reference, groupReference, checkoutId, brand: { id, name, handle }, customerName,
  shipToPreview: { city, country }, placedAt, currency, subtotalMinor, shippingMinor, totalMinor, refundedMinor,
  itemCount, previewItems: [{ productId, variantId, name, qty, unitMinor }], states: { merchant, payment, fulfilment, return, dispute }, service }`.
  `states.merchant` is the one status to show: `pending_payment | paid | processing | shipped | delivered | cancelled | refund_requested | refunded`.
- `OrderDetailDto` = the summary plus `{ lines: [{ id, variantId, productId, title, qty, unitMinor, returnedQty, restockedQty,
  variantLabel, image: { src, alt, width, height } }], shipTo (full address object), paidAt, cancelledAt, cancelReason,
  deliveredAt, completedAt, refundableMinor, returns[], refunds[], disputes[], timeline[], actions: { canCancel, canRequestReturn, returnWindowEndsAt }, delivery }`
  (exact types: `src/lib/api/contracts/orders.ts`). `variantLabel` is the variant's option values
  ("M / Black"), or empty for a product without options.
- **Mark shipped with tracking:** `POST …/shipment { "status": "shipped", "carrier": "GIG Logistics", "trackingNumber": "GIG123" }`
  (a tracking number needs a carrier: 400 `fields.carrier`). Other statuses: `label_created`, `in_transit`,
  `out_for_delivery`, `delivered`, `exception`, `returned`. 422 `rule` when the order can't take it
  (unpaid, cancelled, already delivered). Notifies the shopper. 300 an hour per brand.
- **Cancel:** only before dispatch (`actions.canCancel`). A paid order is refunded in full and needs a
  recent re-confirmation (403 `fields.reauth`, see §1). `idempotencyKey`: 8–64 chars, a new UUID per tap.
- **Refund** (goodwill or partial, ≤ `refundableMinor`): owner/admin only, always needs the
  re-confirmation. 422 when more than what's left.

#### Products

| Method | Path | Role | Body | Success |
|---|---|---|---|---|
| GET | `/api/studio/catalog/products?status=all\|draft\|scheduled\|published\|archived&q=&lowStock=1&limit=&offset=` | any | – | 200 `{ products: StudioProductDto[], total, nextOffset: int \| null }` |
| GET | `/api/studio/catalog/products/{id}` | any | – | 200 `{ product: StudioProductDto }` |
| POST | `/api/studio/catalog/variants/{variantId}/stock` | `orders.fulfil` | `{ mode: "adjust", qty: +1 \| -1 \| n, reason?: "adjustment"\|"restock"\|"correction", note? }` or `{ mode: "set", qty }` | 200 `{ variantId, onHand, held, available }` |
| POST | `/api/studio/catalog/products/{id}/status` | `content.publish` | `{ action: "publish" \| "unpublish" \| "schedule" \| "archive" \| "restore", expectedVersion, publishAt? }` | 200 `{ product }` |
| POST | `/api/uploads?purpose=social_post&as=brand` | `content.publish` | multipart, one field `file` | 201 `{ media: { id: "med_…", src, width, height, … } }` |
| POST | `/api/studio/catalog/products` | `content.publish` | `ProductCreateBody` | 201 `{ product: StudioProductDto }` (a draft) |

- `StudioProductDto`: `{ id, slug, brandId, title, description, details[], category, subcategory, tags[], badges[], priceMinor,
  compareAtMinor, currency, images: [{ id, src, alt, width, height, mediaId }], options: [{ name, values: [{ value, hex? }] }],
  variants: [{ id, sku, options: { [optionName]: value }, label, priceMinor, available, inStock, status, onHand, held, priceOverrideMinor }],
  available, processingDays: [min, max] | null, dropId, collectionIds[], publishedAt, createdAt, status, publishAt,
  moderationStatus, moderationReason, version, updatedAt }`. Show stock per variant with `label` (its option
  values) and `available` (= `onHand - held`). Image `src` is cookie-scoped (`?as=brand`).
- **Stock +/-:** `mode: "adjust"` adds `qty` (negative to remove); never below what live checkouts
  hold (422). `mode: "set"` makes on-hand exactly `qty` (a count).
- **Publish/unpublish:** send the product's current `version` as `expectedVersion`; 409 `conflict`
  when it changed elsewhere (reload, then retry). Publishing needs ≥ 1 photo and ≥ 1 variant and a
  brand that isn't `pending_review` or restricted (422 `rule` with the reason).
- **Quick add** is the website's Quick add, same server path, three steps:
  1. upload each photo (≤ 12) with `POST /api/uploads?purpose=social_post&as=brand` (multipart, one
     `file` field, `Content-Length` required, JPEG/PNG/WebP ≤ 10 MB; 10 per 10 min) → `media.id`;
  2. `POST /api/studio/catalog/products` with
     ```json
     { "title": "2–120 chars", "description": "", "categorySlug": "<slug from /api/catalog/categories>",
       "priceMinor": 4500000,
       "options": [ { "name": "Size", "values": [ { "value": "M" }, { "value": "L" } ] } ],
       "variants": [ { "sku": "KACHI-CANDLE-M", "options": { "Size": "M" }, "initialStock": 3 },
                     { "sku": "KACHI-CANDLE-L", "options": { "Size": "L" }, "initialStock": 2 } ],
       "images": [ { "mediaId": "med_…", "alt": "" } ],
       "badges": ["new"], "processingDays": [1, 3] }
     ```
     Options are generic (0–3 options, any names: "Size", "Colour", "Scent", "Volume"…; colour values may
     add `hex`). A product **without options** sends `"options": []` and one variant
     `{ "sku": "…", "options": {}, "initialStock": n }`. SKUs ≤ 64 chars, unique per brand (the website
     builds them as `HANDLE-TITLE-OPTION`, uppercase). Optional: `compareAtMinor`, `subcategory`, `tags`,
     `details`, `collectionIds`. → 201 `{ product }` with `status: "draft"`;
  3. to put it live at once: `POST /api/studio/catalog/products/{id}/status { "action": "publish", "expectedVersion": product.version }`.

#### Balance and payouts (roles owner, admin, finance)

| Method | Path | Success |
|---|---|---|
| GET | `/api/studio/payouts` | 200 `{ currency, balances: [{ currency, pendingMinor, availableMinor, reserveMinor, inPayoutMinor }], account: PayoutAccountDto \| null, payouts: PayoutDto[] (recent), rules: { tier, reserveBps, reserveDays, commissionBps, minPayoutMinor, onHold, holdReason, cooldownUntil } }` |
| GET | `/api/studio/payouts/{id}` | 200 `{ payout: PayoutDto }` |
| GET | `/api/studio/payouts/account` | 200 `{ account: PayoutAccountDto \| null }` |

- Balance = `availableMinor` (can be paid out), pending = `pendingMinor` (still in the hold window),
  plus `reserveMinor` and `inPayoutMinor`. `PayoutDto`: `{ id, brandId, currency, amountMinor, status:
  "requested"|"awaiting_second_approval"|"approved"|"sending"|"processing"|"paid"|"failed"|"rejected"|"cancelled",
  requestedAt, approvedAt, sentAt, paidAt, failedAt, closedAt, batchId, providerRef, stubRecipient, lastError, rejectReason, approvals[] }`.
- Payout account status: `account` null = "Add a payout account" (on the website for v1);
  otherwise `{ country, currency, bankCode, bankName, accountName, accountLast4, recipientProvider, verified, changedAt, cooldownUntil }`.
  `rules.onHold` / `cooldownUntil` explain why payouts are paused.
- Requesting a payout (`POST /api/studio/payouts { amountMinor, idempotencyKey }`) and changing the
  account (`PUT /api/studio/payouts/account`, owner + re-confirmation) exist; not needed for v1.

#### Inbox

| Method | Path | Role | Body | Success |
|---|---|---|---|---|
| GET | `/api/studio/inbox/conversations?filter=open\|unread\|resolved\|spam\|blocked&q=&cursor=` | `inbox.read` | – | 200 `{ items: ConversationSummary[], nextCursor, counts: { open, unread, resolved, spam, blocked } }` |
| GET | `/api/studio/inbox/conversations/{id}/messages?before=&after=&limit=` | `inbox.read` | – | 200 `ThreadDto` |
| POST | `/api/studio/inbox/messages` | `inbox.reply` | `{ conversationId, clientId, kind: "text" \| "image" \| "product", body?, attachmentIds?, productId?, quickReplyId? }` | 201 `SendResult`; 200 on a retried `clientId` |
| POST | `/api/studio/inbox/conversations/{id}/read` | `inbox.read` | `{ upToSeq }` | 204 |
| GET | `/api/studio/inbox/unread` | `inbox.read` | – | 200 `{ conversations: int }` |

Same `ConversationSummary`, `ThreadDto`, `MessageDto` and `SendResult` as the shopper inbox (see Yard
Support above), seen from the brand: the shopper is `conversation.customer: { id, name, photoSrc }`
(photo `?as=brand`), the brand's own messages have `side: "brand"`. Brands only reply to
conversations a shopper started. Photos: upload with
`POST /api/uploads?purpose=inbox_attachment&as=brand&conversationId=<id>` first. Yard Support for the
brand: `/api/studio/support/…` (shapes above).

#### New from your website

| Method | Path | Role | Body | Success |
|---|---|---|---|---|
| GET | `/api/studio/catalog/website-pieces` | any | – | 200 `{ items: SitePieceDto[], count, mayAdd, site: string \| null, currency }` |
| POST | `/api/studio/catalog/website-pieces/{id}` | `content.publish` | `{ action: "add" \| "skip" }` | 200 same + `productId?`, `published?` |

`SitePieceDto`: `{ id, title, sourceUrl, images: string[] (the site's own URLs), priceMinor, currency, yardPriceMinor,
sizes: string[] (the option values the site lists; may be empty), availability, description, warnings[], status, taken, firstSeenAt, error }`.
"add" copies the photos and creates the product (published when the brand may publish); "skip"
passes for good. 409 when Yard got there first. Show `count` as the badge; hide the buttons unless `mayAdd`.

**Add all / Add selected** (one tap after a big website scan):

| Method | Path | Role | Body | Success |
|---|---|---|---|---|
| POST | `/api/studio/catalog/website-pieces/add-all` | `content.publish` | `{ ids?: string[] (1–100, the selected pieces; omit = every waiting piece), idempotencyKey: string }` | 200 `{ items, count, mayAdd, site, currency, accepted: string[], skipped: [{ id, reason }], replayed?: true }` |

- Each piece goes through exactly the single "add" path, one at a time: claimed first (first wins
  against Yard), photos copied, product created as the brand. A piece that fails goes back to
  waiting; show its `reason` on the card (it's also in that piece's `error` on the next GET).
- `idempotencyKey`: 8–80 of `A–Z a–z 0–9 _ -`, a fresh one per tap (a UUID without dashes works).
  Retrying with the same key (a dropped connection) answers with the first result, `replayed: true`,
  and adds nothing twice. Rate limit: 6 batches a minute; one batch per brand runs at a time.
- The response is the refreshed list, so render `items` / `count` from it directly.

#### Suggestions from Yard (Accept all)

| Method | Path | Role | Body | Success |
|---|---|---|---|---|
| GET | `/api/studio/proposals?status=pending\|all` | any | – | 200 `{ items: ProposalSummaryDto[], total, counts: { pending, accepted, declined, withdrawn, superseded }, nextOffset: null }` |
| POST | `/api/studio/proposals/accept-all` | `content.publish` | `{ ids?: string[] (1–200, the selected ones; omit = every pending suggestion), idempotencyKey: string }` | 200 `{ accepted: string[], skipped: [{ id, reason }], replayed?: true }` |
| POST | `/api/studio/proposals/decline-all` | `content.publish` | `{ ids?: string[], reason?: string (≤ 300), idempotencyKey: string }` | 200 `{ accepted: string[] (the declined ones), skipped: [{ id, reason }], replayed?: true }` |
| POST | `/api/studio/proposals/{id}/accept` | `content.publish` | `{}` | 200 `{ proposal, productId, published }` (one at a time, unchanged) |

- `ProposalSummaryDto`: `{ id, kind: "new" | "edit", status, title, cover, fields[], createdAt, … }`.
- Accept all accepts each suggestion through the single accept, each in its own transaction, so
  versions, stock-as-delta and the audit trail are exactly as one-by-one. Skipped (and still
  pending, with `reason` to show next to the row): an edit whose product changed since Yard
  suggested it ("The product changed since Yard suggested this. Open it to review the changes
  first."), one that fails validation (e.g. a duplicate SKU), or an id that is no longer pending.
- `idempotencyKey` as above: same key = the first result with `replayed: true`, nothing run twice.
  Rate limit: 6 batches a minute (accept-all and decline-all together); one batch per brand at a time.
- Yard is notified once per batch (one notification per Yard admin whose suggestions were answered).
- Decline all needs a confirmation step in the app (the website shows an inline confirm with an
  optional reason). Nothing in the catalogue changes.
- Deep link: the Overview card, the notification and the email for a batch of suggestions open
  `/studio/products/suggestions?focus=accept-all` ("Yard prepared N products for you. Accept all in
  one tap"); the app can route that to its Suggestions screen with Accept all focused.

#### Settings: notifications

| Method | Path | Role | Body | Success |
|---|---|---|---|---|
| GET | `/api/studio/settings/notifications` | any | – | 200 `{ push: { orders, messages, lowStock, payouts } }` |
| PUT | `/api/studio/settings/notifications` | any (their own) | `{ push: { orders?, messages?, lowStock?, payouts? } }` | 200 the saved `{ push }` |
| GET / PUT | `/api/studio/settings/emails` | any / owner+admin | `{ nudges: boolean }` | 200 `{ nudges, canEdit }` (Yard's reminder emails to the brand) |
| POST | `/api/studio/push/test` | any | – | 200 `{ devices: int, delivered: boolean }` |

Push choices are per person and per brand (everything on until switched off). `push/test` sends
"Studio notifications are on" to the caller's own Studio devices (`devices: 0` means this phone
hasn't registered with `studio: true`; `delivered: false` with devices means the server has no push
sender configured).

### 4. Push for brands

**Register the device as Studio-capable**: `POST /api/devices { "platform", "token", "appVersion", "studio": true }`
(the shopper session is enough; devices belong to the person, not the session). Only devices
registered with `studio: true` get Studio pushes, so an older shopper-only app never receives a
Studio link. Omitting `studio` later keeps the stored value.

Who gets what (active members of the brand, never Yard staff), unless they switched the topic off:

| Event | `kind` | Roles | Title / body | `data.url` | `data.link` |
|---|---|---|---|---|---|
| New paid order | `studio.order` | owner, admin, fulfilment | "New order 🎉 ₦45,000" / "₦45,000, Candle (Large) and 1 more" | `/studio/orders/{orderId}` | `yard://studio/orders/{orderId}` |
| New message (shopper, or Yard Support) | `studio.message` | every role | "New message from Ada" / "Open your inbox to reply." ("Yard Support replied" / "Open Yard Support in Studio to read it.") | `/studio/inbox?thread={conversationId}` (`/studio/support`) | `yard://studio/inbox/{conversationId}` (`yard://studio/support`) |
| Low stock after a sale | `studio.low_stock` | owner, admin, designer, fulfilment | "Low stock: Candle (Large)" / "2 left. Add stock to keep selling it." ("Sold out: …" at 0) | `/studio/products/{productId}` | `yard://studio/products/{productId}` |
| Payout sent | `studio.payout` | owner, admin, finance | "Payout sent: ₦120,000" / "It's on its way to your payout account." | `/studio/payouts` | `yard://studio/payouts` |
| Application approved (to the applicant) | `studio.approved` | the applicant | "Your shop is ready" / "{Shop} is approved. Open Studio." | `/studio` | `yard://studio` |
| Test | `studio.test` | the caller | "Studio notifications are on" | `/studio` | `yard://studio` |

The order body is the order total, the first item with its option values in brackets (none for a
product without options), "×n" for several units, and "and N more" for more items.

FCM message (Android; same `data` for iOS once its sender is on):

```json
{ "token": "…", "notification": { "title": "New order 🎉 ₦45,000", "body": "₦45,000, Candle (Large)" },
  "data": { "scope": "studio", "brandId": "b_…", "link": "yard://studio/orders/mo_…",
            "url": "/studio/orders/mo_…", "kind": "studio.order", "id": "studio.order:mo_…" },
  "android": { "priority": "high", "notification": { "channel_id": "yard_updates", "color": "#F5FF00", "tag": "studio.order:mo_…" } } }
```

On tap: `data.scope == "studio"` → if the brand session isn't open on `data.brandId`, call
`POST /api/studio/session/switch { brandId }` first, then open `data.link` in Studio mode. A shopper
push has no `scope` (handle as before). `id` names the event, so a repeat replaces the earlier
notification (`tag`). Every Studio push is also written to the server log as one line
(`[yard] push: studio <kind> brand=<id> key=<…> users=<n> devices=<n> title="…"`).

**Deep links** the app handles in Studio mode: `yard://studio` (home), `yard://studio/orders`,
`yard://studio/orders/{orderId}`, `yard://studio/inbox`, `yard://studio/inbox/{conversationId}`,
`yard://studio/support`, `yard://studio/products`, `yard://studio/products/{productId}`,
`yard://studio/payouts`. Shopper pushes keep using `data.url` paths as before.

### 5. Data and migration

Migration `0026_studio_app`: `push_devices.studio boolean not null default false`, and the table
`studio_push_preferences (user_id, brand_id, orders, messages, low_stock, payouts, updated_at)`,
primary key (user_id, brand_id). Applied at boot like every migration.

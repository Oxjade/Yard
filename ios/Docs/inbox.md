# Inbox (shopper ↔ brand messaging)

Folder: `ios/Yard/Features/Inbox/`. Wording and behaviour follow `src/components/inbox/*` (shopper side).

## Screens

| View | Route | What it does |
|---|---|---|
| `InboxView()` | `.inbox` | Conversation list: brand avatar (monogram + verified tick), name, row time, "You: …" preview, violet unread dot, Resolved/Blocked/Archived tags, muted bell. Search (`.searchable`, 250 ms debounce), filter menu Inbox / Archived / Blocked, pull to refresh, cursor paging, silent refresh when coming back from a thread. Swipe: leading **Mark read** (unread rows), trailing **Archive/Unarchive** + **Mute/Unmute**; on Blocked, **Unblock**. Empty states per filter/search, error with Retry, signed-out invite. |
| `ConversationView(id:)` | `.conversation(id:)` | Thread with one brand (see `InboxThreadScreen`). |
| `BrandConversationView(brandId:)` | `.messageBrand(brandId:)` | Resolves `by-brand`: an existing thread opens as itself; otherwise a new-thread composer ("Ask {brand} anything") whose first send creates the conversation. If the brand can't be messaged, the composer shows why. |

`InboxThreadScreen` (shared): header (logo from the public storefront, name, verified, "Resolved. Writing again reopens it.") → taps to the brand profile; ⋯ menu: View storefront, Mute, Archive, Block/Unblock (confirmation dialog). Pinned **order context bar** ("About order YD-…", status · items · total → `.order(id:)`) when any message carries an order. Bubbles: mine right on acid with `onAcid` text, theirs left on `surface2`; day separators (Today / Yesterday / Wed 4 Nov); time under the last bubble of a run; product cards (photo via one batched `/api/catalog/products?ids=` read, "price when shared", → `.product(slug:)`); order cards (Placed / Items / Total, Open order); photo grids with a full-screen lightbox; held ("Held for review" + copy), removed ("Message removed by Yard."), safety notice and system rows; copy via context menu. Composer: photo button (PhotosPicker, up to 4, JPEG ≤ 2048 px / ≤ 8 MB), growing text field (2,000-char limit with counter), acid send button, haptic. Optimistic sends with "Sending…", failed sends show the server message with Retry / Discard (same `clientId`, so retry never double-sends). Keyboard-safe: composer in `safeAreaInset`, `defaultScrollAnchor(.bottom)`, scrolls to the newest message on new items and when the keyboard opens. "Load earlier messages" pages back.

Polling: every 5 s while the thread is on screen and the app is active (`after=<max seq>`), plus once on returning to foreground. Marks read on open and whenever new brand messages arrive (only when something is unread, so idle polling sends no read POSTs).

## Yard Support

`SupportConversationView(orderId:orderReference:)` (route `.support(orderId:orderReference:)`, links
`/inbox?support=1[&order=<order id>&orderRef=<reference>]`, the "Yard Support replied" notification) is
the shopper's one conversation with Yard's own team. It reuses `InboxThreadModel(supportOrder:)` and
`InboxThreadScreen`: header with the Yard mark (`InboxSupportMark`, the acid logo on black) and "Yard
Support" ("The Yard team. We usually reply within a day." / "Resolved. Writing again reopens it."), no
menu (no mute/archive/block/report), Yard's replies (`side: "support"`) as the other bubble, "Seen"
under the shopper's newest message Yard has read (`receipts.theirs`, when receipts are on). The thread
is created by the first message, so a shopper who never wrote sees the intro and an empty composer;
photos are offered once the thread exists. "Get help from Yard" (order detail) opens it with the order
as a removable chip above the composer; the next send is `kind: "order"` with `orderRefId`, so the
message carries the order card. The inbox list pins the thread above the brand conversations once
it has a message (`GET /api/support/conversation`), and shows a "Message Yard Support" link until then.

- `GET /api/support/conversation` → `{ conversation | null }`
- `GET /api/support/conversation/messages?before=&after=&limit=` (404 before the first message)
- `POST /api/support/messages` `{ clientId, kind: text|image|order, body?, attachmentIds?, orderRefId? }`
- `POST /api/support/conversation/read` `{ upToSeq }`
- Photos: `POST /api/uploads?purpose=inbox_attachment&as=shopper&conversationId=<support id>`

Not done: the typing indicator (the app polls every 5 s, like the brand threads).

## Endpoints

- `GET /api/inbox/conversations?q=&filter=archived|blocked&cursor=` — list
- `GET /api/inbox/conversations/{id}/messages?limit=&before=&after=` — thread (+ conversation with `interaction`)
- `GET /api/inbox/conversations/by-brand/{brandId}` — existing thread / can message
- `POST /api/inbox/messages` `{ conversationId | brandId+origin:"inbox", clientId, kind: text|image, body?, attachmentIds? }`
- `POST /api/inbox/conversations/{id}/read` `{ upToSeq }` (list swipe reads the newest seq first with `limit=1`)
- `PATCH /api/inbox/conversations/{id}` `{ archived? , muted? }`
- `POST` / `DELETE /api/inbox/blocks` `{ brandId }`
- `POST /api/uploads?purpose=inbox_attachment&as=shopper&conversationId=|brandId=` (multipart `file`)
- `GET /api/catalog/storefronts/{brandId}` (brand name/handle/logo for the header), `GET /api/catalog/products?ids=…` (product card photos)

## Private helpers (in this folder)

`InboxModels.swift` (wire models), `InboxAPI.swift`, `InboxFormat.swift` (day labels, disabled-composer reasons, order status labels — copied from the website), `InboxThreadModel.swift`, `InboxMessageViews.swift`, `InboxComposer.swift`, `InboxThreadScreen.swift`. Nothing in Core/DesignSystem was changed.

## Not done / notes

- Sharing a product or an order from the composer, quick-action rail (Sizing / In stock? / Delivery / Next drop), ♥ reactions, report, in-thread search, typing indicator and read receipts ("Seen") are web-only for now. Incoming product/order cards, reactions-free bubbles and held/removed states render.
- List rows use the monogram: list DTOs carry no logo and fetching one per row would fan out requests. The thread header loads the real logo (one cached public read).
- No inbox unread badge anywhere (would need `GET /api/inbox/unread` in a foundation-owned place).
- Cost: each open thread polls the API every 5 s (≈ 720 reads/hour/open thread, each one rate-limit check on the server). It stops when the screen goes away or the app is backgrounded. The list does not poll.

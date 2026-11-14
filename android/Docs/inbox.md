# Inbox (Android) — shopper ↔ brand messaging

Package `features/inbox/`. Mirrors `ios/Yard/Features/Inbox/` file for file (see `ios/Docs/inbox.md` for behaviour and copy).

## Screens

| Composable | Route | Notes |
|---|---|---|
| `InboxView()` | `Route.Inbox` | `InboxListModel`: list, search field (250 ms debounce), filter menu Inbox / Archived / Blocked, pull to refresh (`PullToRefreshBox`), cursor paging, silent refresh on resume (back from a thread). Empty states per filter/search, error + Retry, signed-out invite, skeleton. |
| `ConversationView(id)` | `Route.Conversation` | `InboxThreadScreen` with `InboxThreadModel.forConversation(id)`. |
| `BrandConversationView(brandId)` | `Route.MessageBrand` | by-brand resolve → existing thread or new-thread intro + composer ("Ask {brand} anything"); disabled composer explains why. |

`InboxThreadScreen`: header (logo from storefront, name, verified, Resolved/Muted line → brand profile), ⋯ menu (View storefront, Mute, Archive, Block/Unblock with confirmation dialog), pinned order context bar, bubbles, day separators, run times, product/order cards, photo grid + full-screen pager lightbox, held/removed/safety/system rows, long-press Copy. Composer: Android photo picker (`PickMultipleVisualMedia`, up to 4; JPEG ≤ 2048 px, ≤ 8 MB, prepared off the main thread), growing field with 2,000-char counter, acid send + haptic. Optimistic sends ("Sending…", failure → Retry/Discard with the same `clientId`). "Load earlier messages".

Polling: every 5 s while the screen's lifecycle is RESUMED (`repeatOnLifecycle`), once immediately on returning; stops when the screen is covered, popped or the app is backgrounded. Mark-read on open and when brand messages arrive.

## Yard Support

The shopper's one conversation with Yard's own team (docs/APP.md › Yard Support on the website branch). It is an inbox conversation of kind `"support"` in the inbox's own DTOs, so it reuses `InboxThreadScreen`, the bubbles and the composer; `YardSupport.kt` holds the rest.

| Piece | What |
|---|---|
| `YardSupportConversationView(orderId, orderRef)` | `Route.YardSupport` (also `/inbox?support=1[&order=&orderRef=]` links and the support-reply push, `data.url` `/inbox?support=1`). `InboxThreadModel.forSupport(chip)`; signed-out gate. |
| `InboxThreadModel.isSupport` | Same load / 5 s poll / older pages / optimistic send / retry with the same `clientId` / mark read, through `YardSupportAPI`. No storefront, logo or product reads. The thread is created by the first message (`conversation: null` and a 404 thread read before it = fresh composer). Photos only once the thread exists (upload `conversationId=<support thread>`). |
| Header | `YardSupportMark` (Yard logo in acid on black, avatar-shaped), "Yard Support", "The Yard team. We usually reply within a day." / "Resolved. Writing again reopens it."; no ⋯ menu (no archive, mute, block or report). |
| Order help | `orderChip`: the order rides above the composer as a removable chip (`InboxOrderChipView`), goes out with the next message as `kind: "order"`, `orderRefId` (text optional; photos win, as on the website), then clears. A failed send keeps its order for Retry. |
| Inbox list | `InboxListModel.support` (GET /api/support/conversation, best effort, with every load/refresh). Pinned row above the brand rows once it has a `lastMessage` (Inbox filter, no search; no swipe/long-press actions), else a "Message Yard Support" link under the list / empty state. Two-pane: selection `"yard-support"` opens the support thread in the detail pane and streams back to the pinned row (`applySupportUpdate`). |

Endpoints: `GET /api/support/conversation`, `GET /api/support/conversation/messages?before=&after=&limit=`, `POST /api/support/messages` `{ clientId, kind: text|image|order, body?, attachmentIds?, orderRefId? }`, `POST /api/support/conversation/read` `{ upToSeq }`, `POST /api/uploads?purpose=inbox_attachment&as=shopper&conversationId=`.

Entry points: You › "Message Yard Support", Settings › Help and legal › "Message Yard Support", order detail › Help › "Get help from Yard" (`Route.YardSupport(order.id, reference)`), inbox pinned row / link, notifications and push.

Not done (same as the brand inbox): typing indicator and "Seen" receipts (the app polls; no SSE), unread badge.

## Tablet & large screens

- **Inbox → thread** is a `ListDetailLayout` on Expanded (≥ 840dp): list pane (top bar + filter, search, rows; the open row is highlighted on `surface2`) beside the thread (`InboxThreadScreen` with no back button). The open conversation id lives in `rememberSaveable`; nothing selected = "Pick a conversation" `EmptyState`. System back closes the open thread first. The thread's conversation streams into the list (`InboxListModel.applyThreadUpdate`): unread dot, preview, mute/archive/block and order update live, since the list never resumes while both panes show. If the window shrinks below Expanded with a thread open, that thread is pushed as `Route.Conversation`. Compact/Medium: list only, rows push as on phones.
- List content is capped by `AdaptiveContent` on Medium (720dp); inside the Expanded list pane it fills the pane.
- Thread (`ConversationView`, `BrandConversationView`, detail pane): header full width; bubbles, order bar and composer capped by `AdaptiveContent`.
- `@YardTabletPreviews` on `InboxView` (live + a two-pane fixture preview) and on the thread.
- Touch targets: composer photo/send are 40dp circles inside 48dp touch areas; the remove-photo badge has a 48dp area; "Back to inbox" uses `minimumInteractiveComponentSize`.

## Endpoints

Same as iOS: `GET /api/inbox/conversations`, `GET /api/inbox/conversations/{id}/messages`, `GET /api/inbox/conversations/by-brand/{brandId}`, `POST /api/inbox/messages`, `POST /api/inbox/conversations/{id}/read`, `PATCH /api/inbox/conversations/{id}`, `POST`/`DELETE /api/inbox/blocks`, `POST /api/uploads?purpose=inbox_attachment&as=shopper&conversationId=|brandId=`, `GET /api/catalog/storefronts/{brandId}`, `GET /api/catalog/products?ids=…`.

## Differences from iOS

- Swipe actions: Material `SwipeToDismissBox` has one action per side, so swipe → is **Mark read** (unread rows), swipe ← is **Archive/Unarchive** (or **Unblock** on Blocked). **Mute/Unmute** (iOS's second trailing button) lives in the long-press menu, which also has every other row action.
- Thread list uses `reverseLayout` so the newest message stays anchored above the composer/keyboard (iOS `defaultScrollAnchor(.bottom)`); scrolls to the newest on new items.
- Context menu "Copy" → long-press dropdown. `.searchable` → an inline search pill under the top bar. Confirmation dialog → `AlertDialog`.
- Photo EXIF rotation is applied on API 28+ (`ImageDecoder`); on API 26–27 the `BitmapFactory` path does not rotate (no exifinterface dependency).
- Composer photos/text: text is `rememberSaveable`; picked-but-unsent photos survive rotation/resize (the activity handles those in place) but not process death. The lightbox selection (message id + index) and the block confirmation are `rememberSaveable`.
- Polling also runs once as soon as the thread is shown (a no-op during the first load), so a thread reopened from a cached model (detail pane) catches up at once instead of after 5 s.
- `InboxAPI.client` is an internal test hook (null = `APIClient.shared`).

## Tests

`YardSupportTest` (18): support DTOs exactly as docs/APP.md, send-body kinds, thread load/no-thread/404/poll/older pages/first send/order help/retry, photo upload query, pinned row and link, `/inbox?support=1` links and notification hrefs.


`app/src/test/java/space/yardstore/app/features/inbox/` (36 tests, MockWebServer): DTO decoding/encoding (`InboxModelsTest`), formatting and disabled-composer copy (`InboxFormatTest`), `InboxThreadModel` (load, mark read, storefront/product reads, polling, new-thread first send, blocked reason, failed send + retry with same clientId, discard, older pages, mute/block, day grouping) and `InboxListModel` (sorting, paging, filter/search params, error vs refresh, archive/mute/mark-read/unblock, busy state, photo upload query, two-pane thread → list sync).

## Not done

Same as iOS: product/order sharing from the composer, quick replies, reactions, report, typing indicator and read receipts are web-only; no unread badge.

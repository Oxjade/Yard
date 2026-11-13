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

## Endpoints

Same as iOS: `GET /api/inbox/conversations`, `GET /api/inbox/conversations/{id}/messages`, `GET /api/inbox/conversations/by-brand/{brandId}`, `POST /api/inbox/messages`, `POST /api/inbox/conversations/{id}/read`, `PATCH /api/inbox/conversations/{id}`, `POST`/`DELETE /api/inbox/blocks`, `POST /api/uploads?purpose=inbox_attachment&as=shopper&conversationId=|brandId=`, `GET /api/catalog/storefronts/{brandId}`, `GET /api/catalog/products?ids=…`.

## Differences from iOS

- Swipe actions: Material `SwipeToDismissBox` has one action per side, so swipe → is **Mark read** (unread rows), swipe ← is **Archive/Unarchive** (or **Unblock** on Blocked). **Mute/Unmute** (iOS's second trailing button) lives in the long-press menu, which also has every other row action.
- Thread list uses `reverseLayout` so the newest message stays anchored above the composer/keyboard (iOS `defaultScrollAnchor(.bottom)`); scrolls to the newest on new items.
- Context menu "Copy" → long-press dropdown. `.searchable` → an inline search pill under the top bar. Confirmation dialog → `AlertDialog`.
- Photo EXIF rotation is applied on API 28+ (`ImageDecoder`); on API 26–27 the `BitmapFactory` path does not rotate (no exifinterface dependency).
- Composer photos/text: text survives configuration changes (`rememberSaveable`); picked-but-unsent photos do not.
- `InboxAPI.client` is an internal test hook (null = `APIClient.shared`).

## Tests

`app/src/test/java/space/yardstore/app/features/inbox/` (33 tests, MockWebServer): DTO decoding/encoding (`InboxModelsTest`), formatting and disabled-composer copy (`InboxFormatTest`), `InboxThreadModel` (load, mark read, storefront/product reads, polling, new-thread first send, blocked reason, failed send + retry with same clientId, discard, older pages, mute/block, day grouping) and `InboxListModel` (sorting, paging, filter/search params, error vs refresh, archive/mute/mark-read/unblock, busy state, photo upload query).

## Not done

Same as iOS: product/order sharing from the composer, quick replies, reactions, report, typing indicator and read receipts are web-only; no unread badge.

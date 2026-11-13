# Home (owner: home) — Android

Package: `features/home/` (mirrors `ios/Yard/Features/Home/`).

## Files
- `HomeView.kt` — `HomeView()` (Home tab root). Custom header (Yard logo in `ink`; bell → `Route.Notifications`, forum → `Route.Inbox`, red dot when unread), `HomeTabStrip` (For you · Following when signed in · each category with `productCount > 0`; sliding underline, selected tab scrolls to centre, haptic tick), `HomeFeedView` per tab (skeleton / error / empty / masonry, pull to refresh, infinite scroll, `tabPillScrollSensor`), footer ("Couldn't load more. Try again" / "You're all caught up").
- `HomeFeedModel.kt` — `HomeFeedModel` (per-tab loader + mixing, same rules as iOS), `HomeFeedCache` (one model per visited tab), `HomeViewModel` (the screen's ViewModel: cache, categories, unread badges).
- `HomeTiles.kt` — `HomeProductTile` (ProductTile, tap → product; long press → menu: Save/Remove from saved, Share `https://yardstore.space/products/<slug>` via the Android share sheet, Open <brand>), `HomeBrandTile` (cover, avatar, name, location, "Brand" tag, Follow/Following chip via FollowStore), `HomeDropTile` + `HomeDropCountdown` (ticks every second; "Starts in", "Entries open in", "Entries close in", "Ends in", "Live now", "Ending", "Coming soon"), `HomeFoundingRow`/`HomeFoundingCard` (snapping rail).
- `HomeModels.kt` — `HomeCategory`, `HomeCategoriesResponse`, `HomeInboxUnread`, `HomeNotificationsResponse`, `HomeTab`, `HomeFeedItem`, `HomeShape` (same djb2 stable hash and shapes as iOS).

## Endpoints (same as iOS)
- `GET /api/catalog/categories`
- `GET /api/catalog/products?sort=new&limit=24&offset=` (+ `&category=<slug>`); Following: `?brand=<id>&sort=new&limit=6` for the first 24 follows
- `GET /api/catalog/brands?sort=new&limit=24`, `?founding=1&limit=8`
- `GET /api/drops?phase=live&limit=8`, `?phase=upcoming&limit=8`
- Badges (signed in): `GET /api/notifications?as=shopper`, `GET /api/inbox/unread`

## Differences from iOS
- Loads run in `HomeViewModel.viewModelScope`, so switching tabs never cancels a load; a pull to refresh cancels an in-flight "load more" (iOS doesn't — logged in ios-flaws.md).
- Each tab keeps its own scroll position (iOS resets on switch via `.id`). Tab switch cross-fades.
- Masonry is the shared `LazyVerticalStaggeredGrid` (`MasonryGrid`), balanced by measured height, so `HomeFeedItem.heightRatio` isn't needed and wasn't ported.
- Context menu → long-press `DropdownMenu`; `ShareLink` → `Intent.ACTION_SEND` chooser; `.ultraThinMaterial` on the Following chip/countdown → translucent scrim pill.
- Pull to refresh = Material 3 `PullToRefreshBox` with Yard colours.

## Tests
`app/src/test/java/space/yardstore/app/features/home/` — 24 tests (models/DTO decoding, stable hash/shapes, countdown labels, feed mixing, paging, errors, Following merge, ViewModel badges/categories against MockWebServer).

## Unfinished / notes
- Badges don't live-update (no realtime channel); they refresh when the shopper changes.
- Following tab shows pieces only (not the site's collection/drop/story feed items). No swipe between tabs (tap only), as iOS.

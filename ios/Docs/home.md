# Home (owner: home)

Folder: `ios/Yard/Features/Home/`

## Files
- `HomeView.swift` — `HomeView()` (tab root, replaces the placeholder). Custom header (Yard logo; bell → `.notifications`, inbox → `.inbox`, red dot when unread), `HomeTabStrip` (For you · Following when signed in · each category with `productCount > 0`), `HomeFeedView` per tab (cached in `HomeFeedCache`, so switching tabs doesn't refetch), skeleton / error / empty states, pull to refresh, infinite scroll, `TabPillScrollSensor`.
- `HomeFeedModel.swift` — `@Observable @MainActor` per-tab loader and the feed mixing.
- `HomeTiles.swift` — `HomeProductTile` (ProductTile + NavigationLink + context menu: Save/Remove, Share link `https://yardstore.space/products/<slug>`, Open brand), `HomeBrandTile` (cover photo, name, location, Follow/Following chip via FollowStore), `HomeDropTile` + `HomeDropCountdown` (ticking badge: "Starts in", "Entries open in", "Entries close in", "Ends in"), `HomeFoundingRow`/`HomeFoundingCard`.
- `HomeModels.swift` — `HomeCategory`, `HomeTab`, `HomeFeedItem`, `HomeShape` (deterministic tile heights; stable hash), small response structs.

## Endpoints
- `GET /api/catalog/categories` → `{ categories: [{ slug, name, productCount, … }] }` (tabs)
- `GET /api/catalog/products?sort=new&limit=24&offset=` (For you, paged by `nextOffset`); `&category=<slug>` (category tab)
- `GET /api/catalog/brands?sort=new&limit=24` (brand tiles; founding brands and brands without a cover are skipped)
- `GET /api/catalog/brands?founding=1&limit=8` (Founding brands row at the top of For you; hidden when empty; wording from the site's `FoundingBrandsSection`)
- `GET /api/drops?phase=live&limit=8` and `?phase=upcoming&limit=8` (drop tiles; same params as the site's upcoming-drops band)
- Following tab: mirrors the site's `LiveFollowingFeed` — `FollowStore.items` (GET /api/follows), then `GET /api/catalog/products?brand=<id>&sort=new&limit=6` for the first 24 follows, merged newest first, revealed 24 at a time.
- Badges (signed in only, once per shopper id): `GET /api/notifications?as=shopper` (count of `read == false`), `GET /api/inbox/unread` (`conversations`).

## Mixing / layout
- After every 5th product one tile is inserted, alternating drop then brand (falling back to whichever remains). Prefix-stable, so new pages append without reshuffling the masonry columns.
- Product heights come from the cover image's width/height; when the API sends none, `HomeShape.shaped` gives the cover a stable per-id aspect (4:5, 2:3, 3:4, 1:1) so the shared `ProductTile` varies.

## Unfinished / notes
- Badges don't live-update (no realtime channel); they refresh when the shopper changes. Notifications/Inbox screens should mark read.
- Following tab shows pieces only (not the site's collection/drop/story feed items).
- No swipe between tabs (tap only).

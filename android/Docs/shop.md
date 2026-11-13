# Shop (features/shop) — Android

Mirrors `ios/Yard/Features/Shop` and `ios/Docs/shop.md`.

## Screens

| Composable (kept) | Route | Notes |
|---|---|---|
| `CategoriesView()` | `Route.Categories` | "Categories" display header + live subtitle, mosaic (one wide card, then two half, repeating) of `CategoryCard`s ("01", name, description on wide cards, "N pieces from M brands" / "Coming soon"), "Not sure where to start?" + **Shop everything** → `Route.Shop`. Skeleton, error (retry), "No categories yet" empty state, pull to refresh. |
| `ShopView(category)` | `Route.Shop`, `Route.Category(slug)` | "Shop" header or the category photo banner ("All categories" → `Route.Categories`). Sticky `ShopFilterBar`: category chips (whole shop only), subcategory chips, piece count, **In stock** chip, sort menu (Newest / Price low–high / Price high–low). Masonry of `ProductTile`s, paging 24 at a time, "That's all N pieces" footer, inline "Try again" when a next page fails, old results dimmed while a filter change reloads, stale responses dropped. Empty states: "Nothing matches those filters" (Clear filters) or "No … pieces yet" (See upcoming drops / Browse brands). Pull to refresh. |
| `CollectionView(brand, handle)` | `Route.Collection` | 440dp cover hero (collection photo, else first piece), glass brand chip → brand profile, "A collection by …", name, description. "N pieces" + client-side sort (Featured / Newest / Price low→high / high→low). Masonry (no brand line). "More from {brand}" rail of the other collections → `Route.Collection`. Share button (Android share sheet with the web URL). "Collection not found" (server message) and error states, skeleton, pull to refresh. |

ViewModels: `ShopListingModel`, `CategoriesModel`, `CollectionModel` (same names/logic as Swift).
Models: `ShopModels.kt` (`ShopCategory`, `ShopCategoriesResponse`, `ShopCategoryCache` (5 min in-memory, Mutex), `ShopSort`, `ShopCollectionSort`, `ShopCollectionResponse`, `ShopText`).
Private helpers: `ShopComponents.kt` (`ShopDisplayText` = display face with `minimumScaleFactor` via `TextAutoSize`, `shopBleed`, `ShopRefreshBox`, `ShopSortMenu`, `shopShare`).

## Endpoints

- `GET /api/catalog/categories`
- `GET /api/catalog/products?sort=&limit=24&offset=&category=&subcategory=&inStock=1`
- `GET /api/catalog/storefronts/{brand}/collections/{handle}`
- `GET /api/catalog/products?ids=…(≤60)&limit=60&offset=0&sort=new` (chunks of 60, re-ordered to the collection order)
- `GET /api/catalog/storefronts/{brand}` (optional: logo + other collections; failures ignored)

## Differences from iOS

- **Sticky filter bar**: `LazyVerticalStaggeredGrid` has no pinned headers, so the bar is a full-width grid item and an identical copy is overlaid at the top once it scrolls to the top.
- **Sort menus**: SwiftUI `Menu` → Material `DropdownMenu` in Yard colours (check mark on the current option).
- **Pull to refresh**: Material 3 `PullToRefreshBox` with a Yard-coloured indicator.
- **Share**: `ShareLink` → `Intent.ACTION_SEND` chooser.
- **Haptics**: `.sensoryFeedback(.selection)` → `HapticFeedbackType.TextHandleMove` on sort/stock changes.
- Previews use `ShopListingModel.preview`, `CategoriesModel.preview`, `CollectionModel.preview` (no network), like the Swift preview-only inits.
- Models take an `APIClient` + base URL (internal constructors) so unit tests can run them against MockWebServer.

## Tests

`app/src/test/java/space/yardstore/app/features/shop/`: `ShopModelsTest` (DTO decoding, count/pieces wording, sorts, mosaic layout) and `ShopViewModelsTest` (listing load/paging/dedupe/filters/sort/errors, category cache, collection order/chunking/not-found/storefront failure, categories load/fail) against MockWebServer.

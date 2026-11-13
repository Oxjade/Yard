# Product (features/product/)

Mirrors `ios/Yard/Features/Product/` (see `ios/Docs/product.md`) file for file.

## Screens
- `ProductDetailView(slug)` (route `Route.Product`) → `ProductDetailScreen(model)`: `YardTopBar` with Share (system share sheet, web URL `/products/{slug}`) and a bag button with an acid count badge that bounces on change; `PullToRefreshBox` around a `LazyColumn`: gallery (`ProductGallery`: `HorizontalPager` with page dots, gallery tag, thumbnail `LazyRow` that centres the current photo), brand row (avatar, verified, place, Founding tag, Message, Follow/Following), display title, price (variant price, compare-at, Sale / New Arrival tags), duties line, option pickers, quantity stepper + stock line, website helper line (+ View bag), "Part of a drop" card, expandable description, Details card, Delivery & returns card (estimate / dispatch + cutoff / express / origin / returns copy, Returns policy → `Route.Legal(Refunds)`, Ask brand → `Route.MessageBrand`, Retry on failure), "More from <brand>" and "You might also like" rails (`ProductTile` in `LazyRow`s) with a skeleton until loaded. Sticky bottom bar above the nav-bar inset: save heart, "Choose size / Size M" pill, primary Add to bag / Notify me / Stop watching / Sold out / View bag. States: skeleton, not found (Go back), error (retry). Light + dark + loading previews.
- `ProductSizeSheet` in a `YardSheet` (with its own toast host): options, stock line, main action; closes after a successful add.
- `ProductPhotoViewer`: full-screen `Dialog` (always dark): pager, pinch / double-tap zoom (towards the tap), pan while zoomed, drag down to close, × and system/predictive back close.
- `ProductOptionPicker` (chips, or hex swatches for colour), `ProductStockLineView`.

## Tablet & large screens
- `ProductDetailView` on Medium+ (`isWide`): two columns. Left (55% Medium / 58% Expanded): `ProductWideGalleryPane`, the gallery in its own vertical scroll, the photo capped to the pane height (`ProductGallery(pagerMaxHeight =)`) so it is seen whole. Right: the buy box (brand row, title, price, options, quantity, stock, drop card, description, details, delivery, rails) in its own `LazyColumn` with pull to refresh, and the sticky bar under that column only. When the buy box is narrower than 360dp (Medium) the bar leaves out the "Choose size" pill (the size chips are right above). Compact: one column as before.
- `ProductDetailSkeleton` follows the same two-column shape on Medium+.
- Size sheet stays a bottom sheet (`YardSheet`, capped width); photo viewer is full-screen everywhere.
- `@YardTabletPreviews` for the loaded page (dark + light) and the skeleton.

## Endpoints
- `GET /api/catalog/products/{slug}` → `ProductResponse`
- `GET /api/catalog/products?brand={brandId}&sort=new&limit=9`, `?category={slug}&sort=new&limit=24` (rails)
- `GET /api/shipping/estimate?product=&to=&cur=` (to = cart destination, else device region if a Yard market, else NG)
- `GET /api/wishlist/back-in-stock/{variantId}`, `POST /api/wishlist/back-in-stock {variantId}`, `DELETE /api/wishlist/back-in-stock/{variantId}`
- Via stores: cart add, wishlist toggle, follow toggle.

## Differences from iOS
- `.ultraThinMaterial` bottom bar → opaque `bg` bar with a hairline (stacked under the list, not overlaid).
- `ShareLink` → `Intent.ACTION_SEND` chooser. `.fullScreenCover` → full-screen `Dialog`.
- Back-in-stock state is loaded for the initial variant and after sign-in too (iOS only on change).
- Haptics: `LongPress` for add/follow/watch, `TextHandleMove` for option choice and save.
- A failed pull to refresh (product already shown) keeps the page and shows the server message as an error toast (iOS swallows it silently; logged in ios-flaws.md).
- Touch targets: Message (40dp circle), Share / Bag (38dp glass), photo-viewer ×, colour swatches and the "View bag" / "Read more" / "Retry" links sit in 48dp touch areas.

## Tests
`app/src/test/java/space/yardstore/app/features/product/`: `ProductDetailModelTest` (MockWebServer: load, rails filtering, estimate, not found, error, estimate failure, selection/stock/actions, bag limit, opening, back-in-stock POST/DELETE, refresh failure keeps the page and returns the message, first-load failure goes to the phase) and `ProductHelpersTest` (DTO decoding, shipping formats, swatch hex, country names, initial selection, tablet gallery width).

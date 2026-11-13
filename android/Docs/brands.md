# Brands (features/brands)

Mirrors `ios/Yard/Features/Brands` (see `ios/Docs/brands.md`).

## Screens

- **BrandsDirectoryView()** (`Route.BrandsDirectory`): title bar + pill search field (debounced
  250 ms; name, handle or city), sort chips (A–Z / New on Yard), Founding chip, category chips (only
  categories present among listed brands, website order). Two-column `LazyVerticalGrid` of
  `BrandDirectoryCard` (cover + logo + "Opening soon", name + verified, "City, Country · Category",
  Founding badge, Follow/Following pill). Infinite scroll, pull to refresh, skeleton, "No brands
  match" + Clear search, error + Retry, "Load more brands" after a failed page, and the
  "Brands are joining Yard" state (→ Drops).
- **BrandProfileView(handle)** (`Route.Brand`), reference 02: full-bleed hero (storefront cover,
  else first product photo, else purple gradient) under the status bar, parallax on scroll, fading
  into a blurred copy then `bg`. Huge condensed name + verified, @handle, Founding badge, place,
  category; wide white Follow pill (sign-in gate, haptic, server follower count) + round Message
  button; glass back and "…" menu (Share via Android share sheet, Copy link, Report brand → /support).
  Real stats only. "Opening soon on Yard" banner with Notify me. Story card (Read more).
  Announcement row. Products (masonry, paged) / Collections / Drops tabs with loading / empty /
  error states. Not-found state. Whole page is one `LazyVerticalStaggeredGrid` (via `MasonryGrid`).

## Endpoints

- `GET /api/catalog/brands?q=&category=&founding=1&sort=name|new&limit=24&offset=`
- `GET /api/catalog/storefronts/{handle}` (decoded as `PublicStorefront` + `BrandsStorefrontExtras` for `brand.story`)
- `GET /api/catalog/products?brand={brandId}&sort=new&limit=24&offset=`
- `GET /api/drops?phase=all&brandId={brandId}&limit=50`
- `GET /api/follows/counts`, `POST /api/follows`, `DELETE /api/follows/{id}` (FollowStore)

## Differences from iOS

- Top-left glass button is a back arrow on pushed screens (× only when the screen is a sheet root),
  the Android convention; system/predictive back works as usual.
- No stretch-on-overscroll for the hero (Android overscroll is a glow/stretch of the whole list);
  parallax is kept. `Modifier.blur` only works on API 31+; below it a tiny (48 px) decode keeps the
  backdrop soft.
- The name auto-shrinks by length steps (58/48/40 sp) instead of `minimumScaleFactor`.
- Directory search is an in-page pill field (no `.searchable` navigation drawer on Android).

## Tests

`app/src/test/java/space/yardstore/app/features/brands/`: `BrandProfileModelTest` (12),
`BrandsDirectoryModelTest` (6), `BrandsSupportTest` (7) — MockWebServer with website-shaped JSON.

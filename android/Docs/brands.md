# Brands (features/brands)

Mirrors `ios/Yard/Features/Brands` (see `ios/Docs/brands.md`).

## Screens

- **BrandsDirectoryView()** (`Route.BrandsDirectory`): title bar + pill search field (debounced
  250 ms; name, handle or city), sort chips (A–Z / New on Yard), Founding chip, category chips (only
  categories present among listed brands, website order). `LazyVerticalGrid` at
  `LocalYardWindow.gridColumns` (2 / 3 / 4; skeleton too) of
  `BrandDirectoryCard` (cover + logo + "Opening soon", name + verified, "City, Country · Category",
  Founding badge, Follow/Following pill). Infinite scroll, pull to refresh, skeleton, "No brands
  match" + Clear search, error + Retry, "Load more brands" after a failed page, and the
  "Brands are joining Yard" state (→ Drops). Search text, category, Founding and sort live in the
  ViewModel and are mirrored to its `SavedStateHandle`, so they survive rotation and process death.
- **BrandProfileView(handle)** (`Route.Brand`), reference 02: full-bleed hero (storefront cover,
  else first product photo, else purple gradient) under the status bar, parallax on scroll, fading
  into a blurred copy then `bg`. Huge condensed name + verified, @handle, Founding badge, place,
  category; wide white Follow pill (sign-in gate, haptic, server follower count) + round Message
  button; glass back and "…" menu (Share via Android share sheet, Copy link, Report brand → /support).
  Real stats only. "Opening soon on Yard" banner with Notify me. Story card (Read more).
  Announcement row. Products (masonry, paged) / Collections / Drops tabs with loading / empty /
  error states. Not-found state. Whole page is one `LazyVerticalStaggeredGrid` (via `MasonryGrid`).

## Tablet & large screens

- Directory: grid and skeleton at `gridColumns`; search field and chip rows stay full width.
- Profile on Medium+ (`isWide`): hero 300dp instead of 470dp (skeleton too); the photo and blurred
  backdrop stay full-bleed while the identity block (name, actions, stats, opening-soon, story),
  the announcement + tab pill, drop rows and the drops skeleton are capped at `contentMaxWidth`;
  products at `gridColumns` (3–4); collection cards take one grid lane each (3–4 across) instead
  of full-width 16:10 cards.
- `@YardTabletPreviews` on both screens.

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
- The storefront JSON is decoded twice (`PublicStorefront` + story extras) on `Dispatchers.Default`.

## Tests

`app/src/test/java/space/yardstore/app/features/brands/`: `BrandProfileModelTest` (12),
`BrandsDirectoryModelTest` (9, incl. saved-state restore), `BrandsSupportTest` (7) — MockWebServer with website-shaped JSON.

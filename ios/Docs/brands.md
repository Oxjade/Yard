# Brands (Features/Brands)

## Screens

- **BrandsDirectoryView()** (`.brandsDirectory`): search (`.searchable`, debounced 250 ms; name,
  handle or city), sort chips (A–Z / New on Yard), Founding chip (shown when listed brands include
  founding brands), category chips (only categories present among listed brands, website order and
  names). Two-column grid of `BrandDirectoryCard` (cover + logo + "Opening soon" tag, name + verified
  seal, "City, Country · Category", Founding badge, Follow/Following pill). Infinite scroll, pull to
  refresh, skeleton grid, "No brands match" + Clear search, error + Retry, and the website's
  "Brands are joining Yard" state when nothing is listed yet (→ Drops).
- **BrandProfileView(handle:)** (`.brand(handle:)`), reference 02: full-bleed hero (storefront cover
  → `coverMediaId`/`coverPath`, else first product photo, else a purple gradient) that stretches on
  pull-down and parallaxes on scroll, fading into a blurred copy of itself and then into `bg`.
  Huge condensed name + verified seal, @handle, Founding badge, place and category. Wide white
  Follow pill (FollowStore, sign-in gate, haptic, shows Following) + round Message button
  (→ `Route.messageBrand(brandId:)`, sign-in gate) + glass × and "…" menu (Share link, Copy link,
  Report brand). Stats: only real ones — followers (`FollowStore.followerCounts`, updated from the
  follow result), products (`ProductsPage.total`), drops (only when the drops list is complete and
  non-empty). Story card (brands.story, else storefront intro; Read more). Storefront announcement
  row (href → app route or Safari). `forSale == false` → "Opening soon on Yard" banner with a
  Notify me action (follows the brand). Segmented Products (masonry, paged) / Collections
  (→ `CollectionView`) / Drops (→ `DropDetailView`), each with loading/empty/error states.
  Not-found state for unlisted handles.

## Endpoints

- `GET /api/catalog/brands?q=&category=&founding=1&sort=name|new&limit=24&offset=`
- `GET /api/catalog/storefronts/{handle}` (decoded twice: shared `PublicStorefront` + private
  `BrandsStorefrontExtras` for `brand.story`, which the shared model doesn't carry)
- `GET /api/catalog/products?brand={brandId}&sort=new&limit=24&offset=`
- `GET /api/drops?phase=all&brandId={brandId}&limit=50`
- `GET /api/follows/counts`, `POST /api/follows`, `DELETE /api/follows/{id}` (via FollowStore)

## Files

`BrandsDirectoryView.swift` (model + view + card), `BrandProfileView.swift` (view, hero backdrop,
story/collection/drop cards), `BrandProfileModel.swift`, `BrandsSupport.swift` (category names,
country names, follow helper, storefront extras, glass circle label, founding badge).

## Unfinished / notes

- **Report:** `POST /api/reports` has no brand subject (only message, conversation, social_post,
  location, location_event), so "Report brand" opens the website's /support page instead.
- Hiding the navigation bar (for the × / … glass buttons from the reference) also disables the
  interactive swipe-back gesture in SwiftUI; × pops the screen.
- "Brands like this" rail, storefront sections (featured, lookbook, social feed) and drop reminders
  from the profile are not built (drop reminders live in DropDetailView).
- Directory has no country filter (the API supports `country=`).

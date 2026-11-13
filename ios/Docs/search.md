# Search (`ios/Yard/Features/Search/`)

## Screens
- **SearchView(query:)** — the Search tab root (`query: ""`) and the `.search(query:)` route. Empty query →
  `SearchHomeView`; non-empty → `SearchResultsView`.
- **SearchHomeView** — big "SEARCH" display title, a large pill search field (focused on appear and when
  the Search tab is re-selected at root), then:
  - idle: **Recent** searches (device only, UserDefaults `yard.search.recents`, max 8, remove one / Clear),
    **Browse** chips (Shop, Charts, Around, Drops, Brands, Categories → `.shop/.charts/.around/.drops/.brandsDirectory/.categories`),
    **Try** chips (top 6 live categories with products, like the website overlay).
  - typing (2+ chars, 220 ms debounce via `.task(id:)`): **Brands**, **Categories** (matched on device from the
    live category list), **Products** (thumb, title, brand, display price), skeleton rows while loading,
    inline error + Retry, "No matches" state with Try chips, and **See all results for "…"** (with total) → pushes `.search(query:)`.
  - Submit (keyboard Search), tapping a recent, or tapping a live result records the term in recents.
- **SearchResultsView(query:)** — display-face query header + piece count, brand matches row (→ `.brand`),
  filter chips (In stock with count, All, category facets with counts), sort menu in the toolbar
  (Best match / Trending / Newest / Price low–high / high–low), masonry of `ProductTile`s with infinite
  paging, pull to refresh, skeleton, error, "nothing with these filters" (Clear filters) and no-results
  states with suggestions (Shop, Brands, Categories, Drops), and the server's `capped` note.

## Endpoints
- `GET /api/search?q=&currency=&limit=6` — type-ahead (items + brands).
- `GET /api/search?q=&currency=&limit=24&sort=&category=&inStock=1&cursor=` — results page; uses
  `items`, `brands`, `total`, `nextCursor`, `capped`, `facets.categories`, `facets.inStockCount`.
- `GET /api/catalog/products?ids=…&limit=` — full products for a results page (same two-step as the
  website's `CatalogListing`), re-ordered to the search order.
- `GET /api/catalog/categories` — Try chips and on-device category matches.
- Currency = `CartStore.currency`.

## Files
SearchView.swift (SearchView, SearchHomeView, preview fixtures `SearchPreviewData`), SearchResultsView.swift,
SearchLiveModel.swift, SearchResultsModel.swift, SearchModels.swift (DTOs, `SearchSort`, `SearchRecents`),
SearchComponents.swift (`SearchFlowLayout` wrap layout, `SearchSectionLabel`, rows, `SearchRowsSkeleton`).

## Not done / notes
- Website overlay also matches Cities (Around gazetteer) and Charts board names on device; not ported
  (no gazetteer/chart-slug data in Core). Browse chips cover Around and Charts.
- Brand hits have no logo in the search API, so `BrandAvatar` shows the monogram.
- No price/size/brand filters on the results page (category + in stock only, per brief).

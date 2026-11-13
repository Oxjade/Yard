# Search (`features/search/`) — Android port of `ios/Yard/Features/Search/`

## Screens
- **SearchView(query)**: the Search tab root (`""`) shows `SearchHomeView`; `Route.Search(query)` shows `SearchResultsView`.
- **SearchHomeView**: "SEARCH" display title and a pill search field (focused, keyboard shown, 350 ms after the Search tab root appears; IME action Search submits). Idle: Recent (device only, max 8, remove one / Clear), Browse chips (Shop, Charts, Around, Drops, Brands, Categories), Try chips (top 6 live categories with products). Typing (2+ chars, 220 ms debounce in `SearchLiveModel.update`): skeleton rows, inline error + Retry, Brands, Categories (matched on device), Products, "No matches" + Try chips, "See all results for “…”" with total. Scrolling dismisses the keyboard.
- **SearchResultsView(query)**: display-face query + piece count, brand pills, filter chips (In stock with count, All, category facets), sort dropdown in the top bar, `MasonryGrid` of `ProductTile`s with infinite paging, pull to refresh, skeleton, error, "Nothing with these filters" (Clear filters), "No results" with Keep looking pills, capped / end-of-list footers.

## Endpoints (same as iOS)
- `GET /api/search?q=&currency=&limit=6` (type-ahead)
- `GET /api/search?q=&currency=&limit=24&sort=&category=&inStock=1&cursor=` (results)
- `GET /api/catalog/products?ids=…&limit=` (full products, re-ordered to search order)
- `GET /api/catalog/categories`
- Currency = `CartStore.currency`.

## Files
SearchView.kt (SearchView, SearchHomeView, `SearchPreviewData`), SearchResultsView.kt, SearchLiveModel.kt,
SearchResultsModel.kt, SearchModels.kt (DTOs, `SearchSort`, `SearchRecents`), SearchComponents.kt
(`SearchFlowLayout` = FlowRow, `SearchSectionLabel`, rows, `SearchRowsSkeleton`).
Tests: `app/src/test/.../features/search/SearchModelsTest.kt` (DTO decoding, helpers), `SearchViewModelsTest.kt` (MockWebServer).

## Differences from iOS
- Recents live in the app's SharedPreferences (`yard`), key `yard.search.recents`, as a JSON string array (order kept).
- The debounce runs in the ViewModel (`viewModelScope` job cancelled per keystroke) instead of `.task(id:)`.
- Coming back to a screen doesn't refetch: the live model keeps results for the same term + currency; the results model reloads only when filters/sort/currency change (`ensureLoaded`) or after a failure.
- Pull to refresh keeps the grid on screen (Material pull-to-refresh indicator) instead of switching to the skeleton.
- The sort `Menu` is a Material `DropdownMenu` styled with Yard tokens; SF Symbols map to Material icons.
- Not ported (same as iOS): city / chart-board matches from the website overlay; brand hits show monograms (no logo in the search API).

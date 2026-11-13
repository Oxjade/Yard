# Shop (Features/Shop)

## Screens

| View (init kept) | Route | What it shows |
|---|---|---|
| `CategoriesView()` | `.categories` | "Categories" display header, a mosaic of big photo cards (one wide, then two half, repeating): index "01", name, live "N pieces from M brands" ("Coming soon" when empty, as on the web). "Not sure where to start?" + **Shop everything** → `.shop`. |
| `ShopView(category: String?)` | `.shop`, `.category(slug:)` | Header ("Shop" or the category photo banner). **Sticky filter bar** (pinned section header): category chips (whole shop only), subcategory chips (when the category has some), piece count, **In stock** toggle chip, **sort menu** (Newest / Price low–high / Price high–low). Product masonry (`MasonryGrid` + `ProductTile`), infinite paging (24 a page), "That's all N pieces" footer, inline retry if a next page fails. Filter changes dim the old results while page one reloads; stale responses are dropped. |
| `CollectionView(brand:handle:)` | `.collection(brand:handle:)` | Cover hero (collection photo, else its first piece), brand chip → brand profile, "A collection by …", name, description. "N pieces" + client-side sort (Featured / Newest / Price, low to high / high to low). Masonry of pieces in collection order. "More from {brand}" rail of the brand's other collections. Share button (web URL). |

All three: skeleton loading, `EmptyState` empty and error states (wording from the website), pull to refresh, light/dark `#Preview`s with inline fixtures (preview-only inits `CategoriesView(previewCategories:)`, `ShopView(previewCategory:categories:products:)`, `CollectionView(previewModel:)`; they never fetch).

## Endpoints

- `GET /api/catalog/categories` → `{ categories: [{ slug, name, description, imagePath, subcategories, productCount, brandCount }] }` (cached in memory 5 min by `ShopCategoryCache`, shared by Categories and Shop).
- `GET /api/catalog/products?category=&subcategory=&inStock=1&sort=new|price_asc|price_desc&limit=24&offset=` → `ProductsPage`.
- `GET /api/catalog/storefronts/{brand}/collections/{handle}` → `{ collection, brand: { id, handle, name } }`; 404 shows "Collection not found" with the server's message.
- `GET /api/catalog/products?ids=…&limit=60` (repeated `ids`, chunks of 60) for the collection's pieces, re-ordered to the collection's order.
- `GET /api/catalog/storefronts/{brand}` (optional; failure ignored) for the brand logo and the other collections.

## Files

`ShopModels.swift` (ShopCategory, ShopCategoriesResponse, ShopCategoryCache, ShopSort, ShopCollectionSort, ShopCollectionResponse, ShopText), `ShopListingModel.swift`, `ShopView.swift` (+ `ShopFilterBar`), `CategoriesView.swift` (+ `CategoryCard`), `CollectionView.swift` (+ `CollectionModel`, `CollectionCard`).

## Not done / notes

- The web shop also has search, brand, price-band, size and country filters (via its search endpoint facets); the app's filter bar covers category, subcategory, in stock and sort only, which is what `/api/catalog/products` supports.
- The "title" sort the API allows is not offered (not in the website's sort menu).
- The category banner's "All categories" link pushes `.categories` (it does not pop back if you came from there).
- No shared code was added or changed.

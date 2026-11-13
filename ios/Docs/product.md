# Product (Features/Product/)

## Screens
- `ProductDetailView(slug:)` (route `.product(slug:)`): photo pager (TabView page style) with page dots, gallery tag (Opening soon / Sold out / New Arrival / Limited), thumbnail strip; brand row (monogram avatar, verified seal, place, Founding tag, Message button, Follow/Following pill); title (display face), price (variant price, compare-at struck through + Sale tag), "Duties and taxes are confirmed at checkout."; option chips per axis (colour swatches when values carry hex; sold-out values struck through and disabled; all open while the brand is opening); quantity stepper (capped by stock, 10 per line, minus what is already in the bag); stock line ("Only 2 left", "3 of 6 sizes in stock"…); website helper lines; "Part of a drop" card → `.drop(id:)`; expandable description; Details card (bullets, processing time, SKU reference); Delivery & returns card (estimate, dispatch + cutoff, express, origin, returns copy, Returns policy → `.legal(.refunds)`, Ask brand → `.messageBrand`); "More from <brand>" and "You might also like" rails (ProductTile in NavigationLinks). Sticky bottom bar: heart (SavedStore), "Choose size / Size M" pill (opens the sheet), primary pill: Add to bag (CartStore.add with variant id + qty, success haptic + toast, toolbar bag badge bounces) / Notify me (back-in-stock watch, also when the brand is not for sale) / Sold out / View bag. Toolbar: ShareLink (web URL `/products/{slug}`) and bag button with count badge.
- `ProductSizeSheet`: "Select a size" sheet (options, stock line, Add to bag / Notify me), closes on success.
- `ProductPhotoViewer`: full-screen, swipe between photos, pinch / double-tap zoom, pan while zoomed, swipe down to close.
- Loading skeleton, not-found and error (retry) states; pull to refresh. Previews light + dark.

## Endpoints
- `GET /api/catalog/products/{slug}` → `ProductResponse`
- `GET /api/catalog/products?brand={brandId}&sort=new&limit=9` and `?category={slug}&sort=new&limit=24` (rails, filtered as the website does)
- `GET /api/shipping/estimate?product=&to=&cur=` (to = `CartStore.destinationCountry`, else device region if it is a Yard market, else NG — the website default)
- `GET/POST/DELETE /api/wishlist/back-in-stock[/{variantId}]` (Notify me; signed-in only)
- Via stores: `POST /api/cart/lines`, wishlist toggle, follows toggle.

## Private additions (inside this folder)
`ProductEstimate`, `ProductBackInStockWatch`, `ProductBackInStockBody`, `ProductShippingFormat` (port of src/lib/shipping/format.ts), `ProductSwatchColor` (hex swatch fill from product data — content, not a theme colour), `ProductBuyAction`, `ProductDetailModel`.

## Unfinished / notes
- No brand logo on the product's `BrandSummary`, so the avatar is the monogram.
- Brand `returnsDays` is not in the public product DTO, so the "N-day returns" line is replaced by the returns copy + policy link.
- Drop phases (upcoming/draw) are not evaluated here; the drop card links to the drop screen and the server refuses adds it won't allow (shown as a toast).
- No destination picker on this screen; no product view beacon (signals) is sent; size guide not ported.

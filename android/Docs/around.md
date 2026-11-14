# Around (android/app/src/main/java/space/yardstore/app/features/around/)

Port of `ios/Yard/Features/Around` (see `ios/Docs/around.md`). Brand stores, showrooms, pop-ups and
exhibitions on a map, with a sheet listing the places in view, nearest first.

## Screens
- `AroundView()` (route `Route.Around`): `YardTopBar("Around")`, the search pill ("Search a city or
  area") + locate button, the website's dark 3D globe (MapLibre GL JS in a WebView, see below) with a
  brand-mark pin per place (clustered when close, purple ring when selected, kind dot: store ink,
  showroom grey, live acid, upcoming outline) and the shopper's dot, and a non-dismissable three-detent sheet
  (150dp + nav bar / half / full; the map stays usable above it) holding `AroundPlacesList`:
  skeleton rows, error + retry, "No places on Yard Around yet" (+ Browse brands), "No places here
  yet" (+ Show all places), else rows nearest first with status / next-event lines and distance.
- `PlaceDetailView` (inside the sheet; back = sheet back button or system back): photos, brand +
  Follow (FollowStore; signed-out → Sign in sheet), category · kind tag, address, distance, status,
  description, Visit storefront, Directions, opening hours (today bold, place zone noted) or dates,
  "Happening here" (See {drop} → `Route.Drop(slug)`), "Pieces here" (→ `Route.Product`), Share
  (`/around?place={id}`, Android share sheet). 404 → "Not on Around any more".

## Tablet & large screens
- **Expanded (≥ 840dp)**: no bottom sheet. The list / place detail sit in a fixed side panel at the
  start (list-pane width, 320–420dp, hairline divider) with the search bar at its top; the map fills
  the rest. Picking a place centres its pin (the phone pulls it above the sheet). The panel keeps
  the same one-deep list ⇄ detail stack (back button + system back).
- **Compact / Medium**: map + three-detent sheet as on phones; on Medium the list and place detail
  are capped at `contentMaxWidth` inside the sheet.
- One composition tree for every width, so rotate / resize / fold never recreates the WebView.
  Wide (Expanded) windows open on a slightly closer globe (zoom 2.1, website `globeCamera(wide)`).
- Place photos size to their container (sheet or panel), not the screen.
- `@YardTabletPreviews` on `AroundScreen` and `PlaceDetailView`.

## Endpoints
- `GET /api/around/places?scope=world` (decoded row by row; bad rows dropped), filtered/sorted on device.
- `GET /api/around/places/{id}`.
- `GET /api/catalog/brands?limit=60&offset=` (≤3 pages) for pin/row logos.

## Files
AroundView.kt (screen, search bar, `AroundPlacesList`), PlaceDetailView.kt (+ `PlaceDetailModel`,
`AroundExit`), AroundViewModel.kt, AroundModels.kt, AroundTime.kt, AroundLocationManager.kt,
AroundComponents.kt (row, status text, skeleton), AroundMap.kt (globe WebView + `AroundMapController`),
AroundGlobeBridge.kt (typed Kotlin ⇄ JS messages, camera maths), AroundSheet.kt (three-detent sheet),
AroundFixtures.kt (previews only). Page: `app/src/main/assets/around/` (index.html, globe.js, globe.css,
vendor/: maplibre-gl 6.16.0 js/worker/css, world-atlas 2.0.2 land-50m + countries-110m, topojson-client
3.1.0, with their licences).
Tests: `app/src/test/java/space/yardstore/app/features/around/` (DTO decoding, hours/dates/
distance helpers, view-model load/error/refresh/logo paging/filter/search, detail model incl. 404,
tablet layout helpers: side-panel width, selection framing, photo width; `AroundGlobeBridgeTest`: pin
JSON, select/flyTo/you messages, parsing page messages, camera ⇄ region mapping).

## Different from iOS (on purpose)
- **Map**: MapKit → the website's globe. MapLibre Native for Android has globe projection only in
  preview builds (`13.7.0-pre-globe.0`, `2026.x-globe`; stable 13.7.1 has none), so the Around screen
  hosts a full-size `WebView` running **MapLibre GL JS 6.16.0** (the website's version) from the APK's
  assets via `WebViewAssetLoader` (`https://appassets.androidplatform.net/assets/around/index.html`;
  no remote JS, navigation blocked, file/content access off). It ports `around-map.tsx`: `baseStyle`
  (globe projection, #060609 ocean, #1d1c24 land, hairline coasts and borders, no atmosphere), the
  grey rim, clustered DOM pins/clusters (`pins.ts`) with `opacityWhenCovered: 0` so far-side pins hide,
  the "you" dot, and OpenFreeMap streets as a quiet enhancement (max zoom 14.5 → 18 when they load;
  credits "Natural Earth" / "+ © OpenStreetMap contributors, OpenFreeMap" top right). Pins show the
  brand logo when the directory has one, else the monogram. The globe is dark in light mode too, like
  the website. Kotlin ⇄ JS: `window.yardGlobe.receive({type: places|select|flyTo|you})` and
  `YardAndroid.post({type: ready|placeTapped|cameraIdle|streets|fallback})` (`AroundGlobeBridge`).
  Camera: opens on the website's `GLOBE_CAMERA` (12° N 15° E, zoom 1.6); regions become a centre +
  zoom with the website's `fitPoints` maths; below zoom 3 the whole world counts as "in view" for the
  list. No WebGL 2 → a one-line note over the map; the list still works. A dead renderer is recreated.
  Not ported (yet): the gazetteer's area rings / names, city coastlines (`/vendor/around-coast`), the
  scale bar, credit-spot avoidance.
- **Sheet**: Material 3 sheets have two states, so `AroundSheet` is an in-screen non-modal sheet with
  iOS's three detents. Because it is part of the screen, leaving Around (storefront, drop, product,
  brands, sign-in) just pushes/presents on the router — no close-then-reopen dance.
- **Location**: framework `LocationManager` (no Play services); permission via the runtime prompt.
  "Denied" = asked before and Android won't prompt again → the same "Location is off" toast.
- **Search geocoding**: `android.location.Geocoder` instead of CLGeocoder (device service; may be
  absent → the "Couldn't find" toast). Address has no radius, so the view is 30 km for a city,
  240 km for a region, 800 km for a country.
- **Directions**: a `geo:` intent (coordinate for street pins, address text for area pins), falling back
  to openstreetmap.org; caption says "Opens your maps app".

## Unfinished (same as iOS)
Website filters, online-only brands list, tile-based fetching, report place/event.

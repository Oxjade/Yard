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
AroundGlobeBridge.kt (typed Kotlin ⇄ JS messages, camera maths), AroundGazetteer.kt (website
gazetteer, area search and cameras), AroundSheet.kt (three-detent sheet),
AroundFixtures.kt (previews only). Page: `app/src/main/assets/around/` (index.html, globe.js, globe.css,
vendor/: maplibre-gl 6.16.0 js/worker/css, world-atlas 2.0.2 land-50m + land-110m + countries-110m,
topojson-client 3.1.0, with their licences; data/gazetteer.json; coast/ city coastlines; fonts/ Archivo
and Space Grotesk woff2).
Tests: `app/src/test/java/space/yardstore/app/features/around/` (DTO decoding, hours/dates/
distance helpers, view-model load/error/refresh/logo paging/filter/search, detail model incl. 404,
tablet layout helpers: side-panel width, selection framing, photo width; `AroundGlobeBridgeTest`: pin
JSON (marks), select/flyTo/reveal/you/chrome/motion messages, parsing page messages, camera ⇄ region
mapping; `AroundGazetteerTest`: bundled gazetteer, area search, area cameras matching the web build,
Locate never using the fix, kind chips).

## Different from iOS (on purpose)
- **Map**: MapKit → the website's globe. MapLibre Native for Android has globe projection only in
  preview builds (`13.7.0-pre-globe.0`, `2026.x-globe`; stable 13.7.1 has none), so the Around screen
  hosts a full-size `WebView` running **MapLibre GL JS 6.16.0** (the website's version) from the APK's
  assets via `WebViewAssetLoader` (`https://appassets.androidplatform.net/assets/around/index.html`;
  no remote JS, navigation blocked, file/content access off). `globe.js` is a line-for-line port of
  the website's `around-map.tsx`, `areas.ts`, `pins.ts`, `world-data.ts` and `svg-fallback.tsx`
  (plus the title, the "you" hint and the pin reveal from `around-app.tsx`):
  - `baseStyle`: globe projection that flattens to Mercator as you zoom in, #060609 ocean, #1d1c24
    land, hairline coasts (opacity 0.1→0.24) and borders, atmosphere off, the grey rim overlay, the
    static star field. Dark in light mode too, like the website.
  - Gazetteer (`assets/around/data/gazetteer.json`, generated from `src/lib/around/gazetteer.ts`):
    city dots from zoom 3.6, city names (wide caps) from 4, neighbourhood dashed rings (45% of the
    nearest sibling, 0.5–1.6 km), dots and names from 10.2; names placed clear of pins, the title,
    the credits and the sheet (`placeLabel`), and a ring/dot fades when its name can't show.
  - City coastlines (`assets/around/coast/*.json`, © OpenStreetMap contributors, ODbL) fade in from
    9.4 within 160 km of a covered city, prefetched during flights; credit gains "© OpenStreetMap
    contributors" while one is in view.
  - Pins: the brand's own wordmark (`brand.mark` text + face: condensed / expanded / grotesk, in the
    bundled Archivo and Space Grotesk, OFL) on card with an ink ring, kind dot, dashed ring for
    samples, purple 3px ring + 1.1× when selected; clusters (radius 56, to zoom 14) stack up to three
    distinct brands with a count chip; far-side markers hidden.
  - Title (Earth / country / city / neighbourhood, or the open place's area), compact credits behind
    an info button (fold at the first gesture) that move to a spot no pin covers, scale bar from 8,
    the "you" dot or, when it's off screen, "You're 13 km south-east of the map centre".
  - Camera: opens where Around was left, else 12° N 15° E at 1.6 (2.1 wide); min 0.8, max 14.5 → 18
    with streets; padding keeps the globe above the sheet's peek; flights at speed 1.6 / curve 1.4,
    jumps under reduced motion (system "Remove animations" is passed in). Wide screens rotate and
    get zoom + reset-north buttons. Choosing a place reveals its own pin above the sheet (out of a
    cluster, zoom ≥ 13) only when it isn't already clear.
  - OpenFreeMap streets as a quiet enhancement (rings step back to 0.07, gazetteer names never
    repeated); untested from the build container (tiles.openfreemap.org is blocked there).
  - No WebGL 2 or a failed map → the website's simplified SVG map with one button per city;
    tapping a city lists its places in the sheet.
  Kotlin ⇄ JS: `window.yardGlobe.receive({type: places|select|flyTo|reveal|you|chrome|motion})` and
  `YardAndroid.post({type: ready|placeTapped|cameraIdle|streets|fallback|cityTapped})`
  (`AroundGlobeBridge`). Area cameras (search, Locate) are the website's `areaCamera` /
  `cameraForFix` (`AroundGazetteer`): Locate goes to the nearest neighbourhood (13.5) or the framed
  city, never the fix; a fix that arrives on its own only draws the dot. Search tries the
  gazetteer first, then places and the device geocoder. Below zoom 4 every place counts as in view.
  Kind chips (Stores, Showrooms, Pop-ups, Exhibitions & events, Drops & offers) filter pins and list.
  Not ported: the website's Filters panel (open now, this week, distance, categories), the area
  pill, the phone carousel and list/map toggle (the sheet does those jobs), search suggestions.
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
Website Filters panel (kind chips are done), online-only brands list, tile-based fetching, report place/event.

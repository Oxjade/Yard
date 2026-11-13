# Around (android/app/src/main/java/space/yardstore/app/features/around/)

Port of `ios/Yard/Features/Around` (see `ios/Docs/around.md`). Brand stores, showrooms, pop-ups and
exhibitions on a map, with a sheet listing the places in view, nearest first.

## Screens
- `AroundView()` (route `Route.Around`): `YardTopBar("Around")`, the search pill ("Search a city or
  area") + locate button, an osmdroid map with a brand-avatar pin per place (acid ring when selected,
  acid dot when open/live) and the shopper's dot, and a non-dismissable three-detent sheet
  (150dp + nav bar / half / full; the map stays usable above it) holding `AroundPlacesList`:
  skeleton rows, error + retry, "No places on Yard Around yet" (+ Browse brands), "No places here
  yet" (+ Show all places), else rows nearest first with status / next-event lines and distance.
- `PlaceDetailView` (inside the sheet; back = sheet back button or system back): photos, brand +
  Follow (FollowStore; signed-out → Sign in sheet), category · kind tag, address, distance, status,
  description, Visit storefront, Directions, opening hours (today bold, place zone noted) or dates,
  "Happening here" (See {drop} → `Route.Drop(slug)`), "Pieces here" (→ `Route.Product`), Share
  (`/around?place={id}`, Android share sheet). 404 → "Not on Around any more".

## Endpoints
- `GET /api/around/places?scope=world` (decoded row by row; bad rows dropped), filtered/sorted on device.
- `GET /api/around/places/{id}`.
- `GET /api/catalog/brands?limit=60&offset=` (≤3 pages) for pin/row logos.

## Files
AroundView.kt (screen, search bar, `AroundPlacesList`), PlaceDetailView.kt (+ `PlaceDetailModel`,
`AroundExit`), AroundViewModel.kt, AroundModels.kt, AroundTime.kt, AroundLocationManager.kt,
AroundComponents.kt (pin, user dot, row, status text, skeleton), AroundMap.kt (osmdroid wrapper),
AroundSheet.kt (three-detent sheet), AroundFixtures.kt (previews only).
Tests: `app/src/test/java/space/yardstore/app/features/around/` (37: DTO decoding, hours/dates/
distance helpers, view-model load/error/refresh/logo paging/filter/search, detail model incl. 404).

## Different from iOS (on purpose)
- **Map**: MapKit → osmdroid 6.1.20 (`org.osmdroid:osmdroid-android`, OpenStreetMap tiles, no key;
  user agent = application id, tile cache in the app cache dir). Pins are Compose views placed over the
  MapView at projected coordinates. Dark mode inverts the tiles. "© OpenStreetMap contributors" is shown
  (licence requirement). No rotation, so no compass.
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

# Around (ios/Yard/Features/Around/)

Brand stores, showrooms, pop-ups and exhibitions on a map. Mirrors the website's `/around`
(`src/components/around`, `src/lib/around/{hours,labels,geo}.ts`).

## Screens
- `AroundView()` (route `.around`, placeholder replaced, init kept). MapKit `Map` (iOS 17 content
  builder) with a brand-avatar `Annotation` pin per place (acid ring when selected, acid dot when
  open/live), `UserAnnotation`, compass; top bar = city/area search field + locate button
  (`CLLocationManager` when-in-use). A non-dismissable bottom sheet (detents 150pt / medium /
  large, map stays interactive up to medium) holds the list of places **in the visible map region,
  nearest first** (from the shopper, else the map centre) with status lines from hours/dates.
  States: skeleton rows, error + retry, "No places on Yard Around yet" (+ Browse brands), "No places
  here yet. Zoom out or pick another city." (+ Show all places).
- `PlaceDetailView` (pushed inside the sheet's own NavigationStack): photo carousel, brand avatar +
  Follow (FollowStore; signed-out → Sign in), category · kind tag, address, distance, status,
  description, **Visit storefront** (acid), **Directions** (Apple Maps: `MKMapItem.openInMaps` for
  street-precision pins, `maps.apple.com/?daddr=<address>` for area pins; sample places say
  "Sample location — not a real address."), opening hours table (today bold, place's zone noted
  when it differs) or pop-up dates, "Happening here" events (promo, "See {drop}" → `.drop`), featured
  pieces (→ `.product`), Share link (`/around?place={id}`). 404 → "isn't on Yard Around any more".
- Leaving Around from the sheet (storefront, drop, product, brands directory, sign-in) closes the
  sheet, then pushes/presents on the main `Router`; the sheet returns on reappear / sign-in dismiss.

## Endpoints
- `GET /api/around/places?scope=world` — all public places once (server/CDN cached); region
  filtering, distance and sorting happen on device, so the location never leaves the phone.
- `GET /api/around/places/{id}` — place detail.
- `GET /api/catalog/brands?limit=60&offset=` (≤3 pages, best effort) — brand logos for pins/rows;
  monogram fallback (place DTOs carry no logo).
- Search: matches loaded places by city / neighbourhood / country / brand (accent-insensitive),
  else `CLGeocoder` for any city, else a toast.

## Files
AroundView.swift (view + `AroundPlacesList`), PlaceDetailView.swift (+ `AroundExit`),
AroundViewModel.swift, AroundModels.swift (DTOs, prefixed `Around*`), AroundTime.swift (port of
hours.ts/labels.ts status lines, in the place's time zone), AroundLocationManager.swift,
AroundComponents.swift (pin, row, status text, skeleton), AroundFixtures.swift (previews only).

## Unfinished / notes
- Website's filters (kind, category, "Drops & offers", open now) and the "online-only brands in
  this city" list (`/api/around/online-brands`) are not built.
- No tile-based fetching (`?tiles=`); the world list is used. Fine at current volume; switch to
  tiles if the place count grows large.
- Report place/event (web ⋯ menu) not built.
- No compile check was possible (Linux).

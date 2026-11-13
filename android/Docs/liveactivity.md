# Order tracking (Android stand-in for the iOS Live Activity)

Package `features/liveactivity`. iOS source: `ios/Yard/Features/LiveActivity/` + `ios/YardLiveActivity/`.
Android has no Live Activities / Dynamic Island, so each tracked order is **one ongoing, silent
notification** on the package's own channel `order_tracking` ("Order tracking", IMPORTANCE_LOW).

## Files

| File | Mirrors | What |
|---|---|---|
| `YardOrderActivityAttributes.kt` | Shared/YardOrderActivityAttributes.swift | attributes, `Step` (packed/shipped/outForDelivery/arrivingSoon/delivered, `title`, `baseProgress`), `ContentState` (step, etaDate, progress 0…1, statusLine), `YardOrderActivityLink` (`yard://you/orders/<id>`, `?view=track`) |
| `LiveActivityOrder.kt` | LiveActivityOrder.swift | DTOs, `load(orderId)` and the pure `make(...)` mapping (identical rules and wording), `LiveActivityDates` |
| `LiveTrackingManager.kt` | LiveActivityManager.swift | `object LiveTrackingManager`: `install(context)`, `start(order)` / `start(orderId)`, `update(orderId, state)`, `end(orderId, finalState, immediately)`, `endAll()`, `sync(orderId)`, `apply(order)`, `resume()`, `trackedOrderIds` (Compose state), `lastError`, `areNotificationsEnabled()` |
| `LiveTrackingNotification.kt` | YardOrderLiveActivity.swift + OrderActivityComponents.swift | channel, `OrderETA`, `orderETACaption`, notification layout |
| `LiveTrackingButton.kt` | LiveActivityTrackButton.swift | `LiveTrackingButton(orderId)` with light/dark previews |

## The notification

- Title `Brand · Step`; text `status line · ETA caption` ("Arrives Thu 14 Nov", "Arrives by 20:00",
  "Estimate pending"); subtext route `BrandCity → DeliveryCity` (brand name / "Home" when unknown);
  BigTextStyle with status, ETA ("3 days — Arrives Thu 14 Nov") and "From Lagos (Brand) to London (You)".
- Determinate progress bar from `progress` (0–100) while live.
- Within 24 h of the ETA the header shows a live chronometer countdown (iOS `Text(timerInterval:)`);
  otherwise the header shows when it was last refreshed.
- Ongoing, silent, only-alert-once, `CATEGORY_PROGRESS`, public on the lock screen, acid accent.
- Tap → `yard://you/orders/<id>`; actions **Details** (same) and **Track** (`?view=track`). MainActivity's
  existing `yard://` intent filter + `Router.open` handle them.
- Delivered: `end(finalState)` re-posts it non-ongoing and auto-cancelling, removed after 2 h
  (`setTimeoutAfter`) — iOS's 2-hour dismissal policy. Cancelled/returned: removed immediately.
- Running state is read from the posted notifications (attributes stored in extras), like
  `Activity.activities`, so it survives process death; a swiped-away notification counts as stopped.

## Hooking it up (other owners)

- **Foundation** (`YardApp.onCreate`): `LiveTrackingManager.install(this)` (also registers `endAll()`
  as a sign-out listener). Until then, `LiveTrackingButton` installs it on first composition.
  On foreground: `LiveTrackingManager.resume()`.
- **Orders** (`OrderDetailView`), after the order loads: `scope.launch { LiveTrackingManager.sync(id) }`;
  optionally `LiveTrackingButton(orderId = id)` in the delivery section.
- **Manifest**: needs `<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />`
  (requested at runtime by the button on Android 13+). Nothing else (no receiver/service).

## Endpoints

`GET /api/orders/{id}`, `GET /api/orders/{id}/delivery` (best effort), `GET /api/catalog/storefronts/{handle}`
(`brand.city`, once per order, best effort) — same fields as iOS.

## Not mirrored / different

- No Dynamic Island / acid route card with the moving marker: the progress bar stands in for the arc.
  `Notification.ProgressStyle` (API 36, segments + tracker icon) would be closer; compileSdk is 35.
- No push tokens / server push (iOS stores APNs tokens; no server endpoint exists on either side).
  The app refreshes the notification whenever it syncs the order.
- No "stale after 8 h" text; the header's refresh time shows how old it is.
- Button copy: "Track in notifications" / "Stop tracking in notifications"; when notifications are off,
  an explanation plus "Open notification settings" (iOS shows only a label).
- Small icon: the launcher's foreground "Y" vector (no dedicated monochrome status icon in res/).

## Tests

`app/src/test/java/space/yardstore/app/features/liveactivity/LiveActivityOrderTest.kt` — 22 tests: DTO
decoding (realistic OrderDetailDto / DeliveryDto / storefront JSON), every branch of `make(...)`,
calendar dates, `ContentState`, `OrderETA`; `load()` against MockWebServer (3 endpoints, delivery 500
tolerated, known city skips the storefront, 404, path encoding).

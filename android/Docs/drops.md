# Drops (android/app/src/main/java/space/yardstore/app/features/drops/)

Mirrors `ios/Yard/Features/Drops` (see `ios/Docs/drops.md`): same screens, copy, endpoints and states.

## Screens
- **DropsView()** (`Route.Drops`): header, Live now (4:5 photo cards, acid badge with pulse, ticking
  countdown), Entries open, Upcoming (calendar by local day, 1 s countdown, reminder bell), Past drops
  (masonry), How drops work. Per-feed "Load more", pull to refresh. Regrouped every 30 s on the device
  clock. Top-bar bell → `Route.MyDrops`. The whole page is one `MasonryGrid` (past drops are the
  grid items; everything above is full-line header items), so it stays lazy.
- **DropDetailView(id)** (`Route.Drop`): hero, brand (→ brand profile), title, release card (timing,
  big 1 s countdown, Remind me / Remind me to enter / Reminder set, Enter the draw / Entered → tap
  withdraws, winner card, `me.reason`, entry status), facts, description, "In this drop" products
  masonry. "Shop this drop" bottom bar while live scrolls to the pieces. Share = Android share sheet
  with the web URL. Reloads once each time the clock crosses a phase boundary (checked every 2 s).
- **MyDropsView()** (`Route.MyDrops`): signed-out gate; draw entries and reminders; long-press a
  reminder → "Remove reminder" menu (iOS context menu); "Explore drops".

## Endpoints
- `GET /api/drops?phase=live|upcoming|ended&limit=24&cursor=` → `DropsPage`
- `GET /api/drops/{id|slug}` → `DropDetailResponse`
- `GET /api/catalog/products?ids=…&limit=60` (ordered by `drop.productIds`)
- `GET /api/drops/me` → `MyDropsResponse` (feature-private model in `DropsSupport.kt`)
- `POST|DELETE /api/drops/{id}/reminder`, `POST|DELETE /api/drops/{id}/entry`

## Local reminder (Android equivalent of the UNCalendarNotificationTrigger)
`DropLocalReminder.kt`: `AlarmManager` alarm 10 minutes before opening (entries opening for a waiting
draw) → `DropReminderReceiver` posts a notification on channel `yard.drop-reminders`. Tapping it opens
`MainActivity` with `ACTION_VIEW https://yardstore.space/drops/{slug}` (handled by `router.open`).
Exact alarm when the app may schedule one, else `setAndAllowWhileIdle` (may be a little late on
Android 12+). Turning a reminder on asks for `POST_NOTIFICATIONS` on Android 13+; the drop page and
Your drops re-sync alarms from the server state without prompting.

The manifest (foundation) declares the `DropReminderReceiver` and `POST_NOTIFICATIONS`. Optional,
not added: `SCHEDULE_EXACT_ALARM` for exact timing on Android 12+.

## Tablet & large screens
All decisions come from `LocalYardWindow` (helpers `dropsCardColumns`, `dropsCalendarColumns`,
`DropsWideHeroHeight` in `DropsSupport.kt`).
- **DropsView**: Live now / Entries open cards sit 1 / 2 / 3 per line (Compact / Medium / Expanded)
  instead of one 4:5 card the full width; Upcoming calendar rows 2 per line on wide windows; past
  drops masonry at `gridColumns`; "How drops work" cards side by side on wide windows; header copy
  capped at 640dp. The loading skeleton follows the same layout.
- **DropDetailView**: reading page — the grid (hero, release card, facts, pieces) sits in
  `AdaptiveContent` (720 / 960dp); the hero is a 440dp-high banner on wide windows instead of 4:5;
  the "Shop this drop" bar stays full width with the button capped.
- **MyDropsView**: list wrapped in `AdaptiveContent`.
- `@YardTabletPreviews` on all three screens.

## Not mirrored / differences
- Sign-in changes: iOS `.onChange(of: isSignedIn)`; Android reloads only when the state actually
  changed since the last load (`sessionChanged` / `noteSignedIn`), so re-entering a screen doesn't refetch.
- The upcoming-row bell is a 40dp circle (as on iOS) inside a 48dp touch target.
- Alarms are cleared by a reboot (iOS keeps pending notifications); they come back the next time the
  drop page or Your drops loads. A `BOOT_COMPLETED` receiver was not added.
- Draw fairness block (`GET /api/drops/{id}/draw`) is not ported (not on iOS either).
- Load-more failures are silent (as on iOS).
- Notification small icon is the system `ic_popup_reminder` (no monochrome Yard icon in res/).

## Tests
`app/src/test/java/space/yardstore/app/features/drops/`: phase/wording helpers, large-screen column
helpers, MyDropsResponse decoding, captions, sign-in change detection, and the three ViewModels
against MockWebServer.

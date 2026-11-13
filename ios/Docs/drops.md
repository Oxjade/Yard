# Drops (ios/Yard/Features/Drops/)

## Screens
- **DropsView()** (`.drops`): header, **Live now** (big 4:5 photo cards, acid badge with live pulse,
  ticking "Closes in"), **Entries open** (draws), **Upcoming** (calendar grouped by local day:
  Today / Tomorrow / weekday, each row with release time, thumbnail, 1 s countdown and a reminder
  bell), **Past drops** (masonry), "How drops work". Per-feed "Load more", pull to refresh. Phases
  are recomputed on the device clock every 30 s so drops move section when they open. Toolbar bell → `.myDrops`.
- **DropDetailView(id:)** (`.drop(id:)`, id or slug): hero, brand (→ brand profile), title, release
  card with timing text and a big live countdown (TimelineView, 1 s), action (Remind me / Remind me
  to enter / Reminder set; Enter the draw / Entered → tap withdraws), winner card with purchase
  window, the server's `me.reason`, entry status, facts (run, limit, units left, winners, winner
  window, entries), description, "In this drop" products masonry → `.product(slug:)`. When live a
  "Shop this drop" bottom bar scrolls to the pieces. Share via `ShareLink` (web URL). Reloads quietly
  once each time the countdown crosses a phase boundary (same as the website).
- **MyDropsView()** (`.myDrops`): signed-out gate; draw entries (status tag, purchase-by / entered /
  queue position) and reminders (long-press → Remove reminder); "Explore drops".

## Endpoints
- `GET /api/drops?phase=live|upcoming|ended&limit=24&cursor=` → `DropsPage`
- `GET /api/drops/{id|slug}` → `DropDetailResponse` (`me` when signed in)
- `GET /api/catalog/products?ids=…&limit=60` (repeated `ids`, ordered by `drop.productIds`, as the website does)
- `GET /api/drops/me` → `MyDropsResponse` (private model in `DropsSupport.swift`)
- `POST|DELETE /api/drops/{id}/reminder` (sign-in required), `POST|DELETE /api/drops/{id}/entry`

## Local notification
Turning a reminder on asks for notification permission (first time) and schedules a
`UNCalendarNotificationTrigger` 10 minutes before the drop opens (before entries open for a
waiting draw). Identifier `yard.drop-reminder.{dropId}`; `userInfo` has `path` (`/drops/{slug}`),
`url` and `dropId`. Removing the reminder cancels it. The drop page and Your drops re-sync the alert
(without prompting) from the server's state, so web-set reminders and rescheduled drops stay right.

## For the integrator / not done
- Tapping the notification: the app delegate (foundation) should pass `userInfo["url"]` to
  `router.open(_:)`; no `UNUserNotificationCenterDelegate` exists in my folder.
- Draw fairness block (`GET /api/drops/{id}/draw`: seed hash, revealed seed) from the website is not ported.
- Load-more failures are silent (button just reappears).
- Private helpers live in `DropsSupport.swift` (phase calc port of `dropPhaseAt`, wording, `DropLivePulse`,
  `DropStatusBadge`, `DropActions`, `DropLocalReminder`, preview fixtures).

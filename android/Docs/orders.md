# Orders (`features/orders/`)

Mirrors `ios/Yard/Features/Orders/` file for file (same type names, copy, endpoints, states).
References: `06-order-confirmed-ticket.jpg`, `07-order-status-timeline.jpg`.

## Screens

- **OrderConfirmationView(checkoutId)**: glowing seal badge (acid / violet pending / danger failed,
  sunburst + breathing glow), heading from the real state, the checkout as a ticket
  (`OrderTicketShape` notches + dashed perforation), details grid, one section per brand order
  (→ order), copy order ID. Track order / Keep shopping; abandoned → Pay now (Custom Tab) / Check
  again; failed → Return to bag / See your orders. Polls every 2.5 s for 60 s while pending (every
  4th read is `POST …/verify`), then "Still confirming…" + Retry. × and system back pop the tab to
  root (iOS hides back). Reloads the cart once paid (+ haptic).
- **OrdersListView()**: grouped by checkout, filter chips All / In progress / Completed with counts,
  pull to refresh, "Load older orders" (also auto-loads when it scrolls into view), skeleton,
  empty, error, signed-out.
- **OrderDetailView(id)**: status icon + display status + note, brand chip, **TrackingCard** once
  shipped, Status / Details `SegmentedPill`. Status: timeline (`OrderTimelineBuilder`), estimate,
  carrier updates, collapsible order history. Details: items, summary, ship-to, tracking (copy +
  "Track with …"), returns (request-a-return sheet), help (message brand, refunds policy), cancel.
- **TrackingCard** + `OrderTrackingSnapshot.from(order, brandCity)`: acid card, big ETA, route arc
  (dashed, solid travelled part via `PathMeasure`, marker at progress), Details / Track.

## Endpoints

`GET /api/orders?limit=50&before=`, `GET /api/orders/{id}`, `GET /api/orders/checkouts/{checkoutId}`,
`GET /api/checkout/{id}`, `POST /api/checkout/{id}/verify`, `POST /api/orders/{id}/cancel`
`{reason, idempotencyKey}`, `POST /api/orders/{id}/returns` `{lines, reason, note, idempotencyKey}`,
`GET /api/catalog/storefronts/{handle}` (brand city, best effort).

## Differences from iOS

- **Live Activity not wired**: `TODO(liveactivity-integrator)` in `OrderDetailView.kt`
  (`orderDetailReload` = `LiveActivityManager.sync`, and the `LiveActivityTrackButton` slot).
- `confirmationDialog` (cancel) → a Yard bottom sheet with Cancel order / Keep order.
- `DisclosureGroup` → animated expandable row. `.refreshable` → Material3 `PullToRefreshBox` with
  Yard colours (`OrderRefreshBox`). SwiftUI coloured shadow on the seal → drawn radial glow.
- "Placed …" footer is hidden when the date is missing (iOS shows a dangling "Placed ").
- Same open items as iOS: delivery complaints and withdrawing a return aren't in the app; Message
  brand doesn't attach the order id; the return stepper's minus shows a trash icon at 1.

## Tests

`app/src/test/java/space/yardstore/app/features/orders/`: `OrderHelpersTest` (DTO decoding,
text helpers, timeline, tracking snapshot, grouping/filtering) and `OrderModelsTest`
(view models + OrdersAPI against MockWebServer: paging, errors, polling/verify/timeout, cancel,
returns, path encoding). 34 tests.

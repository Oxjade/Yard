# Orders (`ios/Yard/Features/Orders/`)

Owner: orders agent. References: `06-order-confirmed-ticket.jpg`, `07-order-status-timeline.jpg`,
`03-dynamic-island-sequence.jpg` (tracking card).

## Screens

- **OrderConfirmationView(checkoutId:)** (`.orderConfirmation`): glowing seal badge (acid glow +
  sunburst in dark, soft halo in light; violet "pending" / danger "failed" variants), heading from
  the real state ("Order confirmed" / "Order placed" / "Payment wasn’t completed"), the checkout as
  a **ticket** (`OrderTicketShape` with side notches + dashed perforation), details grid (Order
  number, Date, Items, Total / Total charged, Delivery to, Payment method), one perforated section
  per brand order (status chip, taps through to the order), copy order ID. Buttons: **Track order**
  (one brand → that order, several → Orders list) and **Keep shopping**; failed → Return to bag /
  See your orders; abandoned → Pay now (provider page) / Check again. While pending it polls
  every 2.5 s for 60 s (every 4th read is `POST …/verify`), then "Still confirming…" + Retry —
  same as the website. Back button hidden; × pops the tab to root. Reloads the cart once paid.
- **OrdersListView()** (`.orders`): GET /api/orders grouped by checkout (checkout id, else group
  reference), one card per checkout ("Checkout REF", "Placed …, N brands shipping separately",
  payment line, total) and one row per brand order with `OrderStatusChip`. Filter chips All /
  In progress / Completed with counts, pull to refresh, "Load older orders" (cursor; also
  auto-loads when it scrolls into view), skeleton, empty, error and signed-out states.
- **OrderDetailView(id:)** (`.order(id:)`): status icon, big display status ("On its way"…) +
  the website's note, brand · order chip (→ brand). **TrackingCard** on top once shipped (+ the
  live-activity agent's `LiveActivityTrackButton` while shipped). Card with `SegmentedPill`
  Status / Details:
  - Status: vertical timeline Paid → Packed → Shipped → Out for delivery → Delivered (done = filled
    with timestamp, current = pulsing dot + note, future = hollow; cancelled / returned to sender /
    payment failed end in a red stop row), estimated arrival (or "Running late"), carrier updates
    (shipment events), and the full order history (event labels from the website) in a disclosure.
  - Details: items, summary (subtotal, shipping/Free, refunded, total, payment sentence), ship-to
    address + service, tracking number with Copy + "Track with {carrier}" (carrier URL rules from
    the site), returns (open return status / **Request a return** sheet / outcome / window note),
    help (Message brand → `.messageBrand(brandId:)`, Refunds policy → `.legal(.refunds)`), Cancel
    order (only when `actions.canCancel`, confirmation dialog).
  - After each load it calls `LiveActivityManager.shared.sync(orderId:)` when the order is
    shipped/delivered/cancelled or already tracked (live-activity doc's hook).
- **TrackingCard(snapshot:onDetails:onTrack:)** + `OrderTrackingSnapshot.from(order:brandCity:)`:
  acid card, big ETA (`yardDisplay`), brand city → shopper city arc with solid travelled part and a
  marker at the progress point, service label, Details / Track pills. Same layout as the Live
  Activity route card.

## Endpoints

- `GET /api/orders?limit=50&before=` → `{ items: OrderSummaryDto[], nextCursor }`
- `GET /api/orders/{id}` → `{ order: OrderDetailDto }` (includes `delivery` = DeliveryDto)
- `GET /api/orders/checkouts/{checkoutId}` → `{ items, nextCursor }`
- `GET /api/checkout/{id}`, `POST /api/checkout/{id}/verify` (no body)
- `POST /api/orders/{id}/cancel` `{ reason, idempotencyKey }` → `{ order }`
- `POST /api/orders/{id}/returns` `{ lines[{variantId, qty}], reason, note, idempotencyKey }` → `{ order }`
- `GET /api/catalog/storefronts/{handle}` → `brand.city` (origin of the route line, best effort)

## Files

`OrderModels.swift` (lenient DTOs, `OrderText` formatting helpers), `OrdersAPI.swift`,
`OrderStatus.swift` (shopper wording, chip), `OrderTicket.swift` (ticket shape, perforation,
success badge, details grid), `OrderTimeline.swift` (step builder + view), `TrackingCard.swift`,
`OrderConfirmationView.swift`, `OrdersListView.swift`, `OrderDetailView.swift` (+ return sheet).
All private types are prefixed `Order…`.

## Unfinished / notes

- Not compiled (no Xcode here).
- Delivery complaints (`POST /api/orders/{id}/delivery-complaints`) and withdrawing a return
  (`…/returns/{returnId}/cancel`) are not in the app yet; Help routes to messaging the brand.
- Message brand opens the brand conversation without attaching the order (the route has no
  order parameter; the website attaches `orderId`).
- `yard://you/orders/<id>?view=track` (Live Activity "Track") opens the order; the `view` param
  isn't passed through `Route`, so it doesn't switch tabs/scroll.
- The return quantity uses the shared `QuantityStepper`, whose minus turns into a trash icon at 1.

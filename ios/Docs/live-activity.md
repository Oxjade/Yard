# Live Activity: order tracking (Lock Screen + Dynamic Island)

Owner: live-activity agent. Reference: `Design/References/03-dynamic-island-sequence.jpg`.

## Files

| File | Target | What |
|---|---|---|
| `Yard/Features/LiveActivity/Shared/YardOrderActivityAttributes.swift` | app + extension | `YardOrderActivityAttributes` (orderId, brandName, brandCity, deliveryCity) with `ContentState` (step `packed/shipped/outForDelivery/arrivingSoon/delivered`, `etaDate: Date?`, `progress` 0…1, `statusLine`), `YardOrderActivityLink` (deep links), preview fixtures |
| `Yard/Features/LiveActivity/LiveActivityManager.swift` | app | `@Observable @MainActor LiveActivityManager.shared`: `start(for:)`, `update(orderId:state:)`, `end(orderId:finalState:immediately:)`, `endAll()`, `sync(orderId:)`, `apply(_:)`, `resume()`, `pushTokens`, `trackedOrderIds` |
| `Yard/Features/LiveActivity/LiveActivityOrder.swift` | app | Loads an order from the API and maps it to the activity state (pure `make(...)`) |
| `Yard/Features/LiveActivity/LiveActivityTrackButton.swift` | app | Optional "Track on Lock Screen" / "Stop tracking" button for the order detail screen |
| `YardLiveActivity/YardLiveActivityBundle.swift` | extension | `@main` WidgetBundle |
| `YardLiveActivity/YardOrderLiveActivity.swift` | extension | `ActivityConfiguration`: Lock Screen view, island compact/minimal/expanded, previews for every presentation |
| `YardLiveActivity/OrderActivityComponents.swift` | extension | Route arc with moving marker, acid route card with Details/Track links, ETA figure, logo glyph |

The shared attributes live in `Yard/Features/LiveActivity/Shared/` (the location the foundation's
project.yml template named), so the app target compiles them with no project change and the
extension lists the folder as a source. The extension also compiles `Theme.swift`,
`Typography.swift`, `Metrics.swift`, `YardLogo.swift` and `SVGPathParser.swift` from
`Yard/DesignSystem/` (all self-contained) so it uses the real tokens and logo. **Foundation: keep
those five files free of app-only types** (stores, Router, Config), or the extension stops compiling.

## project.yml

Only change: the `YardLiveActivity` app-extension target (bundle id
`space.yardstore.app.LiveActivity`, iOS 17, `NSExtensionPointIdentifier =
com.apple.widgetkit-extension`) and `dependencies: - target: YardLiveActivity` on `Yard` (embeds it).
The app already had `NSSupportsLiveActivities` and the `yard://` scheme.

## Presentations

- **Lock Screen**: Yard logo + step label; status line and brand; ETA (live `Text(timerInterval:)`
  countdown when ≤ 24 h, otherwise "N days" + "Arrives Thu 14 Nov"); acid route card BRAND CITY →
  YOU CITY with the arc solid up to the marker (step icon) and dashed after it. Follows light/dark
  (`bg`/`ink`); "Open Yard for the latest update" when the activity is stale (8 h without a refresh).
- **Compact**: leading = acid logo glyph; trailing = countdown (≤ 24 h), "3d", a check when delivered,
  or the step icon when there's no ETA.
- **Minimal**: acid logo.
- **Expanded**: leading logo + brand, trailing ETA in acid, center status line, bottom acid route card
  with **Details** (white pill) and **Track** (black pill) `Link`s. Island is always black, acid accents.

## Deep links

- Details → `yard://you/orders/<id>`, Track → `yard://you/orders/<id>?view=track`, whole activity
  (`widgetURL`) → Details.
- These use the path `Route(url:)` already parses (`you/orders/<id>` → `.order(id:)`), so **no change
  is needed**: YardApp's existing `.onOpenURL { url in if !router.open(url) { UIApplication.shared.open(url) } }`
  handles them. `yard://order/<id>` (the brief's short form) is NOT parsed by `Route(url:)` today
  (it would fall through to `UIApplication.shared.open` and bounce back), which is why the long form is used.
  If foundation wants the short form too, add to `Route.init?(url:)`:
  `case "order": guard let id = second else { return nil }; self = .order(id: id)`.
- The Orders screen may read `view=track` to scroll to the delivery section (currently ignored).

## Hooking it up (other owners)

- **Orders** (`OrderDetailView`), after the order loads/refreshes:
  `Task { @MainActor in await LiveActivityManager.shared.sync(orderId: id) }` — starts once shipped,
  updates while running, ends when delivered (stays 2 h) or cancelled/returned (removed).
  Optionally show `LiveActivityTrackButton(orderId: id)` in the delivery section.
- **Foundation** (`YardApp`, in the existing `scenePhase == .active` task):
  `await LiveActivityManager.shared.resume()` — re-attaches push-token observers and refreshes running activities.
- **Auth/You** on sign-out: `await LiveActivityManager.shared.endAll()`.

## Endpoints

- `GET /api/orders/{id}` → `{ order }`: brand `{ id, name, handle }`, `shipToPreview.city`, `states.fulfilment`, `deliveredAt`.
- `GET /api/orders/{id}/delivery` → DeliveryDto: `estimate { basis, arrivalFrom, arrivalTo, deliveredOn, late }`,
  `shippedOn`, `shipTo.city`, `events[{ status, occurredAt }]`.
- `GET /api/catalog/storefronts/{handle}` → `brand.city` (origin city; fetched once per order, best effort).

Mapping: `cancelled`/`returned_to_sender`/`returned` event → end. Delivered (fulfilment, event or
`deliveredOn`) → `.delivered`. Latest `out_for_delivery` → `.outForDelivery`. Shipped/in transit →
`.shipped`, or `.arrivingSoon` once today ≥ `arrivalFrom`. `processing`/`label_created` → `.packed`
(shown only if an activity is already running; never auto-started). ETA = `arrivalTo` at 20:00 local
(the API sends calendar dates). Progress while shipped is time-based between the ship event and the ETA
(0.25…0.78). Wording follows the site ("Out for delivery", "Delayed", "Running late — new estimate").

## Push updates (server work — not done)

Activities are requested with `pushType: .token` (falls back to local-only if the request fails, e.g.
no push entitlement). The token is printed (`[LiveActivity] push token for order …`) and kept in
`LiveActivityManager.pushTokens` + UserDefaults `yard.liveActivity.pushTokens`. **Yard's server has no
endpoint for it yet**, so until then the app updates the activity whenever it refreshes the order.
To go live:

1. Add the Push Notifications capability (`aps-environment`) to the app target.
2. Server endpoint to store `{ orderId, token }` (see the `TODO(server)` in `LiveActivityManager.storeToken`).
3. On each shipment event, send APNs to the token: headers `apns-push-type: liveactivity`,
   `apns-topic: space.yardstore.app.push-type.liveactivity`, `apns-priority: 10` (or 5), body:

```json
{ "aps": { "timestamp": 1763064000, "event": "update",
  "content-state": { "step": "outForDelivery", "etaDate": 785000000, "progress": 0.86, "statusLine": "Out for delivery in London" },
  "stale-date": 1763092800 } }
```

`etaDate` is seconds since 2001-01-01 (Unix − 978307200; ActivityKit's default Date decoding) or omitted.
Use `"event": "end"` with a final `content-state` and `"dismissal-date"` when delivered.

## Unfinished / caveats

- Not compiled (no Xcode here). Server push is not wired (above).
- ETA beyond 24 h shows days rather than a ticking clock (an h:mm:ss timer past 24 h would read "98:11:08").
- Start/stop hooks in OrderDetailView, YardApp and sign-out belong to other owners (lines above).

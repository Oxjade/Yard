# Bag + Checkout (Android, `features/bag/`)

Mirrors `ios/Yard/Features/Bag/` (see `ios/Docs/bag.md`) type for type.

## Files

| iOS | Android |
|---|---|
| BagView.swift | BagView.kt (`BagView()`, `BagView(quotes)`, `BagViewModel`, `BagLineRow`, `BagGroupHeader`, `BagGroupFooter`, `BagNotice`, `BagSkeleton`, shared `BagOptionsMenu`/`BagCountryMenu`, `BagAnimatedPrice`) |
| CheckoutView.swift | CheckoutView.kt (`CheckoutView()`, `CheckoutView(model)`, `CheckoutSection`, `CheckoutTextField`, `CheckoutMenuField`, `CheckoutOptionRow`, `CheckoutBrandShipping`, `CheckoutSummaryRow`, `CheckoutSkeleton`) |
| CheckoutModel.swift | CheckoutModel.kt (`CheckoutModel : ViewModel`, `CheckoutDraft`) |
| BagAPI.swift | BagAPI.kt (`BagEstimate`, `BagQuoteOption`, `BagGroupQuote`, `BagQuoteLoader`, `BagCheckoutOptions`, `BagCheckout`, `BagStartCheckoutBody`) |
| BagMarkets.swift | BagMarkets.kt (`BagCountry`, `BagMarkets`, `BagPaymentMethod`) |
| BagPaymentSafariView.swift | BagPaymentTab.kt (`BagPaymentTabEffect`, `BagPaymentTab`, `BagPaymentPage`) |

Tests: `app/src/test/java/space/yardstore/app/features/bag/` — `BagMarketsTest` (phone/postcode/region rules,
charge currency, methods, arrival ranges), `BagAPITest` (DTO decoding from realistic route JSON, option fallback,
body encoding), `CheckoutModelTest` (MockWebServer: validation, quotes/totals, pay → hosted page → verify → paid,
poll settles while open, abandoned, still pending, stub, failed, 409, 400 field mapping, 401, idempotency key reuse,
payments off), `BagQuoteLoaderTest` (MockWebServer: GET /api/cart query + decoding, city cap, keeps last answer on
error; shipping total across brands; tablet column widths).

## Endpoints

Same as iOS: `GET /api/cart?currency=&to=&city=` (CartStore + `BagQuoteLoader`), `PATCH`/`DELETE /api/cart/lines/{variantId}`
(CartStore), `GET /api/checkout/options`, `POST /api/checkout`, `GET /api/checkout/{id}`, `POST /api/checkout/{id}/verify`.

## Differences from iOS

- **Hosted payment**: `payment.authorizationUrl` opens in a Custom Tab (`WebPages.open`). Custom Tabs have no
  "Done" callback, so the app treats "our activity resumed after the tab took the foreground" as Done and calls
  `paymentPageClosed()` (verify now, then poll every 2 s for ~30 s), exactly like the Swift model. While the tab is
  open the model polls every 3 s (verify every 5th round). When the poll settles/fails while the tab still covers the
  app, `BagPaymentTab.close` restarts the (singleTask) `MainActivity` with CLEAR_TOP, which finishes the tab — the
  iOS equivalent of dismissing the Safari sheet.
- If the website ever verifies `assetlinks.json`, the provider's redirect to `https://yardstore.space/checkout/confirmation?…`
  may open the app via `MainActivity.handleLink` and push a confirmation itself, alongside the model's own push.
  The foundation owns that link handling.
- Swipe to remove = `SwipeToDismissBox` (end to start; snaps back if the DELETE fails). Pull to refresh =
  `PullToRefreshBox` with Yard colours. Menus/pickers = `DropdownMenu` in Yard colours.
- Persisted values (`yard.bag.shipTo`, `yard.bag.shipToCity`, `yard.checkout.draft` as JSON) live in the app's
  SharedPreferences (`Config.preferences`) instead of UserDefaults.
- The bag tab root stays composed while hidden, so it reloads the cart (and re-reads the ship-to country) whenever it
  comes on screen instead of on every `.task`.
- No text-field autofill content types (iOS `textContentType`); keyboard types/capitalisation/IME "Next" are set.
- Not mirrored on either platform: "Saved for later" strip, landmark field (see iOS doc).

## Tablet & large screens (Android only; iOS has no iPad layout)

- **Bag**: Compact = phone layout. Medium = one column capped at `contentMaxWidth` (the bottom bar's content is
  capped too, its background stays full width). Expanded = `AdaptiveContent` row: the lines (header, notices,
  brand groups, taxes note; pull to refresh) on the left, and `BagSummaryPanel` on the right (340–380dp, its own
  scroll): "Order summary" card with Subtotal, Shipping (same words as the checkout summary), total, the
  unavailable-pieces warning and a full-width Checkout. The bottom bar is not shown on Expanded.
- **Checkout**: Compact = phone. Medium = one column capped at `contentMaxWidth`, pay bar content capped.
  Expanded = the form (contact, address, shipping, payment, notes) at reading width on the left and a side
  column (360–400dp, own scroll) with the order summary, payment status/errors/"View order status" and a
  full-width Pay; no bottom pay bar.
- Skeletons and the empty bag header follow `adaptiveContentWidth()`. `@YardTabletPreviews` on both screens.
- The bag's "Delivering to" pill stays 32dp tall but has a 48dp touch target.

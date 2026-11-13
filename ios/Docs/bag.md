# Bag + Checkout (`ios/Yard/Features/Bag/`)

## Screens

- **BagView()** (tab root Bag, `.bag`): lines grouped by brand (each brand ships its own parcel),
  per row photo, title, variant, line price, `QuantityStepper` (0 removes), swipe to remove; per-brand
  subtotal, shipping price and "Est. arrival" from the server quote; delivery-country menu; cart
  `issues` notice; bottom bar with Subtotal/Total and the Checkout pill (signed out → Sign in sheet).
  Empty state "Your bag is empty" → "Discover brands" (`.brandsDirectory`). Skeleton while loading,
  `EmptyState.error` on failure, pull to refresh.
- **CheckoutView()** (`.checkout`): one scrolling page: Contact (name, phone with per-country
  validation), Delivery address (country, street, apartment, city, state/region picker or field,
  postcode — rules ported from `src/components/market/checkout/rules.ts`), Shipping per brand
  (options from the quote, with price and arrival; "doesn't ship here" → remove that brand's pieces),
  Payment method (card / bank transfer / USSD / mobile money, by country + charge currency + provider),
  Order summary (rows + Subtotal / Shipping / Total) and a bottom **Pay** pill. Signed out → sign-in
  gate + Sign in sheet. Payments off → the server's "Payments open soon…" notice, Pay disabled.
  Stub mode → notice; the checkout goes straight to the confirmation (nothing charged).
- Payment: the provider's hosted page (`payment.authorizationUrl`, Paystack or Bachs) opens in
  `SFSafariViewController` (full-screen cover). While it is open the app polls the checkout; on
  Done it verifies and polls ~30 s. Paid/review → `router.pop()` + `.orderConfirmation(checkoutId:)`
  (OrderConfirmationView belongs to the orders agent) and the cart is reloaded. Failed / expired /
  "abandoned" / still pending → a message (nothing charged) and, when still pending, "View order status".

## Endpoints

- `GET /api/cart?currency=&to=&city=` (via `CartStore` for lines; again via `BagQuoteLoader` for the
  per-brand quote with estimates — the shared `ShippingOption` has no `estimate`)
- `PATCH /api/cart/lines/{variantId}`, `DELETE /api/cart/lines/{variantId}` (through `CartStore`)
- `GET /api/checkout/options` (mode, provider, charge currencies)
- `POST /api/checkout` (idempotencyKey, currency, shipTo, shipping[], expectedTotalMinor, paymentMethod)
- `GET /api/checkout/{id}`, `POST /api/checkout/{id}/verify`

## Files

`BagView.swift`, `CheckoutView.swift`, `CheckoutModel.swift` (form, validation, pay + polling),
`BagAPI.swift` (quote/checkout models, `BagQuoteLoader`), `BagMarkets.swift` (countries, phone /
postcode rules, charge currency, payment methods, arrival formatting, persisted ship-to),
`BagPaymentSafariView.swift`. Private helpers are prefixed `Bag…` / `Checkout…`.

## Notes / unfinished

- The checkout charges in the provider's currency (`chargeCurrency`), so the checkout re-reads the
  cart in that currency; prices there can differ from the bag's display currency (a notice says so).
- Delivery details are remembered on the device (`yard.checkout.draft`); there is no address API to
  share with You › Addresses.
- No "Saved for later" strip under the bag (website has one) and no landmark field (not sent to the server).
- Paystack's callback is an https page, so `ASWebAuthenticationSession` can't auto-close on iOS 17.0;
  SFSafariViewController + polling is used instead.

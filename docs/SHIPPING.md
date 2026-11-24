# Courier shipping (Shipbubble)

Yard can connect a Nigerian courier aggregator for **live courier rates at checkout, pickup
booking, labels and tracking**. Shipbubble is the one adapter built today; the provider interface
is written so Topship (or another aggregator) can plug in behind it once its API is documented.

Nothing changes until `YARD_SHIPPING_PROVIDER` is set: the default is `off`, and brands keep their
own rates and add tracking by hand, as before.

**Money model: "Yard pays, shopper refunds Yard".** The shopper pays the courier's live price as
the shipping line. When the brand books the pickup in Studio, Yard's own courier wallet (Yard's
Shipbubble account) pays the courier. The ledger keeps that shipping money out of the brand's
earnings: it is never paid out to the brand, and Admin sees shipping collected vs shipping spent.

## Owner setup

1. **Create the Shipbubble account** at <https://app.shipbubble.com> for Yard's business (not a
   brand's). Shipbubble serves the country the account is registered in only, so register it in
   Nigeria. Finish the business verification Shipbubble asks for: an account has to be verified
   before its wallet can be funded and live labels booked.
2. **Fund the wallet** in the Shipbubble dashboard (Wallet). Every booked pickup is paid from it.
   Keep enough for a few days of orders; Admin › Delivery shows the balance and warns under
   ₦20,000 (`YARD_COURIER_WALLET_LOW`).
3. **Get the API keys** in the Shipbubble dashboard (Settings › API keys & webhooks). There are two:
   `sb_sandbox_…` (test: no courier collects, nothing is charged) and `sb_prod_…` (live). Start with
   the sandbox key, check a full order on staging, then switch to the live key.
4. **Put the key on the server, never in chat, email, a ticket or the repository.** On the server,
   edit `/etc/yard.env` as root and add:

   ```sh
   YARD_SHIPPING_PROVIDER=shipbubble
   SHIPBUBBLE_API_KEY=sb_prod_...          # paste it here, on the server only
   # SHIPBUBBLE_WEBHOOK_SECRET=...         # optional, see below
   # YARD_COURIER_ABSORB_CAP=100000        # optional, kobo: price rises Yard absorbs silently (default ₦1,000)
   # YARD_COURIER_WALLET_LOW=2000000       # optional, kobo: Admin alert line (default ₦20,000)
   # YARD_COURIER_QUOTE_MINUTES=30         # optional: how long a shopper's courier price is held (5–120)
   ```

   Check it before restarting (from the live release, as in docs/DEPLOY.md):

   ```sh
   sudo runuser -u yard -- bash -c 'set -a; . /etc/yard.env; set +a; cd /home/yard/app && node tools/check-env.mjs'
   ```

   A missing or malformed key is listed there (and stops a production start), like the payment
   keys. The startup log says `[yard] shipping: Shipbubble (live)` or `(SANDBOX key …)`.
5. **Set the webhook URL** in the Shipbubble dashboard (Settings › API keys & webhooks › Webhook):

   ```
   https://<domain>/api/webhooks/shipbubble
   ```

   Shipbubble signs each delivery with the **API key** (header `x-ship-signature`), so no extra
   secret is needed. If Shipbubble ever gives the account a separate signing secret, put it in
   `SHIPBUBBLE_WEBHOOK_SECRET`; both are accepted.
6. **Switch it on**: `YARD_SHIPPING_PROVIDER=shipbubble` (step 4), then restart. To turn couriers off
   again, set it to `off` (or remove it) and restart: checkout goes back to the brands' own rates;
   shipments already booked keep their tracking.
7. Tell brands to open **Studio › Shipping & fulfilment › Delivery providers** and save their
   **pickup address** (it's verified with Shipbubble on save) and default parcel weight and box.
   A brand's shoppers see courier prices only once its pickup address is verified.

Production rule: staging first. Test with the sandbox key on staging (an order, Book pickup, the
webhook) before the live key goes on production.

## What shoppers, brands and Admin see

- **Cart**: the brand's own rates as before (the courier needs the full address), with "Ships by
  courier: the courier's price is confirmed at checkout".
- **Checkout › Shipping** (once contact and address are in, signed in): per brand, the live courier
  options (courier name, price, the courier's ETA words and Yard's arrival estimate), cheapest
  first, plus the brand's store pickup if it offers one. The price is held for
  `YARD_COURIER_QUOTE_MINUTES` (30): the checkout charges exactly what was shown. After that, or if
  the option disappears, checkout answers "A delivery option changed. Choose again."
  If Shipbubble is down, answers with no couriers, or the brand isn't set up, **the brand's own
  rates are offered instead**; checkout never breaks on the courier. Courier rates are offered only
  when the checkout charges in NGN (Shipbubble prices and charges in naira).
- **Studio › Orders › an order paid with a courier rate**: a **Courier** panel and a **Book pickup**
  button (Fulfilment, Admin or Owner role). Booking pays the courier from Yard's wallet, saves the
  tracking code (and the courier's waybill when Shipbubble returns one), and moves the order to
  **shipped**; the shopper gets the "shipped" notification and email. **Print label** opens Yard's
  100 × 150 mm label (sender, receiver, courier, order, tracking barcode).
  Idempotent: the order's one booking is claimed before Shipbubble is called, so a double click,
  two tabs or two members book once. If the stored rate can't be reused (the token expired after 7
  days, or its pickup date passed), Yard re-quotes the same courier (or the cheapest) and books it;
  a higher price is absorbed by Yard, silently up to `YARD_COURIER_ABSORB_CAP`, with an Admin alert
  above it. The booking goes ahead either way, so the brand isn't held up.
  If Shipbubble's answer to the booking is lost (timeout, 5xx), the shipment is marked **being
  checked** and is never booked blind a second time; Admin is alerted (check the Shipbubble
  dashboard; the brand can add tracking by hand meanwhile).
- **Tracking**: Shipbubble's webhooks move the order on: picked up → in transit, completed →
  delivered (the return window starts), cancelled → a delivery exception and an Admin alert. The
  shopper is notified and emailed ("shipped", "delivered"); the brand gets a notification. An hourly
  job also asks Shipbubble about booked shipments with no news for 6 hours (at most 25 a run).
- **Admin › Delivery › Couriers**: the wallet balance (read-only, refreshed at most once a minute),
  shipping collected vs spent (ledger), booked shipments with collected vs cost and any absorbed
  difference, and provider failures (rates, bookings, tracking, wallet, unknown shipments). A low
  wallet raises one Admin notification a day.
- **Admin › Finance** shows "Courier shipping collected / spent" per currency, and the Bachs
  reconciliation counts collected courier shipping as money held at Bachs.

## Ledger

| Event | Entries |
| - | - |
| Payment captured, order with a courier rate S | Dr provider_clearing gross; Cr **shipping_collected** S; Cr platform_commission c; Cr brand_pending / brand_reserve (gross − S − c). Commission is taken on the brand's part only (gross − S). |
| Pickup booked, cost C | Dr **shipping_spent** C; Cr **courier_wallet** C. No brand account and no provider_clearing entry. Idempotent per shipment. |
| Refund R | The brand's part first (commission back pro rata); only what is left above the brand's part comes out of **shipping_collected**, so a full refund returns the courier shipping too. |

`ledger_order_money.courier_shipping_minor` records S per order. A brand's owed balance (pending +
available + reserve + in payout) never includes S, so payouts can't include it. `courier_wallet` is
debit-normal and goes negative by what was spent: top-ups happen in Shipbubble, outside Yard; the
real balance is the one Admin reads from Shipbubble. Orders on a brand's own (manual) rates are
unchanged: their shipping is the brand's, as before.

## Configuration reference

| Variable | Default | |
| - | - | - |
| `YARD_SHIPPING_PROVIDER` | `off` | `off`, `shipbubble`, or `topship` (refused: no adapter yet, see below). |
| `SHIPBUBBLE_API_KEY` | | Required for `shipbubble`. `sb_prod_…` or `sb_sandbox_…`; anything else is refused at boot. |
| `SHIPBUBBLE_WEBHOOK_SECRET` | | Optional extra signing key; the API key always counts. At least 16 characters. |
| `SHIPBUBBLE_API_BASE` | `https://api.shipbubble.com/v1` | Only for the local mock. `https://` required in production unless `YARD_ALLOW_HTTP=1`. |
| `YARD_COURIER_ABSORB_CAP` | `100000` (₦1,000) | Kobo. A re-quote dearer than this over what the shopper paid alerts Admin. |
| `YARD_COURIER_WALLET_LOW` | `2000000` (₦20,000) | Kobo. Admin alert line for the wallet. |
| `YARD_COURIER_QUOTE_MINUTES` | `30` | 5–120. How long a shopper's courier price is held. |

Keys are read from the environment only, checked at boot (`src/server/shipping/providers/courier-config.ts`,
called from `src/server/env.ts`), never logged, never sent to the browser, and only the provider in
use is ever called.

## Shipbubble API: what it offers (and doesn't)

Read from the public docs at <https://docs.shipbubble.com> on 2026-11-24. The adapter follows the
documented shapes; where a doc page was unclear, the parsing is defensive (noted below).

| Need | Shipbubble | Source |
| - | - | - |
| Authentication | `Authorization: Bearer <API key>` on every request. Test keys start `sb_sandbox_`, live keys `sb_prod_`. | [Authentication](https://docs.shipbubble.com/get-started/authentication) |
| Sandbox vs live | Same base URL, `https://api.shipbubble.com/v1`; the key decides. | [Get started](https://docs.shipbubble.com/get-started), [Shipbubble API](https://docs.shipbubble.com/) |
| Address validation | `POST /shipping/address/validate` `{name, email, phone, address}` (lat/long optional) → `data.address_code`. Also list/get/edit saved addresses. | [Validate address](https://docs.shipbubble.com/api-reference/addresses/validate-address-global), [Get validated addresses](https://docs.shipbubble.com/api-reference/addresses/get-validated-addresses), [Single address](https://docs.shipbubble.com/api-reference/addresses/get-single-address-details) |
| Package categories | `GET /shipping/labels/categories` → `[{category_id, category}]` ("Fashion wears", …). Yard picks a fashion one. | [Package categories](https://docs.shipbubble.com/api-reference/package-categories) |
| Package dimensions | `GET /shipping/labels/boxes` → standard boxes (height, width, length, max weight). Yard uses the brand's own box size instead. | [Package dimensions](https://docs.shipbubble.com/api-reference/package-dimensions) |
| Rates | `POST /shipping/fetch_rates` `{sender_address_code, reciever_address_code (sic), pickup_date (yyyy-mm-dd, ≤ 7 days ahead), category_id, package_items[{name, description, unit_weight (kg), unit_amount (₦), quantity}], package_dimension{length, width, height}}` → `request_token`, `couriers[]` (courier_id, courier_name, service_code, rate_card_amount, vat, total, currency, pickup/delivery ETA…), cheapest/fastest. `POST /shipping/fetch_rates/:service_codes` limits it to chosen couriers. `PATCH …/request_token` edits sender/receiver on a token. | [Request shipping rates](https://docs.shipbubble.com/api-reference/rates/request-shipping-rates), [Selected couriers](https://docs.shipbubble.com/api-reference/rates/request-shipping-rates-from-selected-couriers), [Edit request token](https://docs.shipbubble.com/api-reference/rates/edit-request-token-details) |
| Rate token life | "A rate request token expires after 7 days of generation." | [Rates](https://docs.shipbubble.com/api-reference/rates) |
| Create shipment / label | `POST /shipping/labels` `{request_token, service_code, courier_id}` (+ optional `insurance_code`) → `order_id`, `courier{name, tracking_code, …}`, `status`, `payment{shipping_fee, type, status, currency}`, `tracking_url`. Some couriers need a waybill: `waybill_document` (a URL) appears on the shipment. | [Create shipment](https://docs.shipbubble.com/api-reference/shipments/create-shipment) |
| Cancel | `POST /shipping/labels/cancel/:order_id`, only for shipments scheduled for a future date. Yard doesn't use it (no cancel button). | [Cancel shipment](https://docs.shipbubble.com/api-reference/shipments/cancel-shipment) |
| Tracking | `GET /shipping/labels` (all) and `GET /shipping/labels/list/:order_ids` → `results[]` with `status`, `package_status[]`, `events[]`, `tracking_url`, `waybill_document`. Statuses: `pending`, `confirmed`, `picked_up`, `in_transit`, `completed`, `cancelled`. | [Get shipments](https://docs.shipbubble.com/api-reference/tracking/get-shipments), [Multiple shipments](https://docs.shipbubble.com/api-reference/tracking/get-multiple-specific-shipments) |
| Webhooks | Events `shipment.label.created`, `shipment.status.changed`, `shipment.cancelled`, `shipment.waybill.updated`, `shipment.cod.remitted`, `shipment.sla.updated`. Header `x-ship-signature` = HMAC-SHA512 of the body keyed with the API key. A 200 is expected within 15 s; failures are retried every 5 minutes, 5 times. The sandbox has a webhook simulator. | [Webhooks](https://docs.shipbubble.com/api-reference/webhooks), [Webhook simulator](https://docs.shipbubble.com/api-reference/webhooks/webhook-simulator-sandbox) |
| Wallet / funding | Shipments are paid from the account's **prepaid NGN wallet** (`payment.type: "wallet"`). `GET /shipping/wallet/balance` → `{balance, currency}`. There is also a "request wallet fund" endpoint; Yard doesn't use it (top-ups stay in the dashboard). | [Wallet](https://docs.shipbubble.com/api-reference/wallet), [Wallet balance](https://docs.shipbubble.com/api-reference/wallet/get-shipping-wallet-balance), [Request wallet fund](https://docs.shipbubble.com/api-reference/wallet/request-wallet-fund) |
| International | "Shipbubble APIs currently only support shipping from your account's country of origin"; another origin country needs another account and key. Destinations abroad are priced by the couriers that serve them (e.g. DHL); Yard offers couriers only to brands shipping from Nigeria. A duties calculator exists (beta), not used. | [Get started](https://docs.shipbubble.com/get-started) |
| Returns, insurance, COD | Return rates (`POST /shipping/returns/:order_id/fetch_rates`), insurance rates and cash on delivery exist; not used. | [Return rates](https://docs.shipbubble.com/api-reference/returns/get-rates-for-a-return-shipment-request), [Insurance](https://docs.shipbubble.com/api-reference/insurance/get-insurance-rates), [COD](https://docs.shipbubble.com/api-reference/cash-on-delivery) |
| Idempotency keys | **Not documented** for creating shipments. Yard's own claim row makes "Book pickup" book once; a lost answer is never retried blind. | — |
| A printable label PDF | **Not documented** beyond `waybill_document` for couriers that need one. Yard prints its own label; the waybill is linked when present. | — |

**Where the docs were unclear, and how the code copes** (`src/server/shipping/providers/shipbubble-core.ts`):

- *Which amount is charged.* The docs describe the courier amount "displayed to your customer" and
  "charged from your shipping wallet"; the examples' `total` is `rate_card_amount + vat − discount`.
  Yard prices with `total` (falling back to `rate_card_amount`) and records the booking's own
  `payment.shipping_fee` as the cost when the booking returns it.
- *ETA fields.* `delivery_eta` is words ("Within 2 - 4 working days"); some answers carry
  `delivery_eta_time` instead. Yard shows the words and reads days or hours from them; when they
  can't be read, the brand's standard transit days are used for the estimate.
- *Webhook status.* The documented example sends a flat shipment with `status`; one integration
  reports that the top-level status can lag behind the newest `package_status` entry. Yard takes the
  furthest step among both, and never moves a shipment backwards.
- *Webhook ids.* No event id is documented; a delivery is deduplicated by a SHA-256 of its body (a
  retry resends the same body).
- *Amounts* arrive as numbers or numeric strings in naira; both are converted to kobo exactly.
- Some doc pages are older than others (their own dates), so field names are re-checked against
  the sandbox before going live (step 3 above).

## Topship

**No adapter.** Topship's API documentation isn't public: a 2022 blog post announces the
door-to-door delivery API and says API keys and docs are requested from tech@topship.africa; no
endpoint reference could be found ([Topship blog: the Topship API](https://blog.topship.africa/topship-api/)).
Building an adapter without documented formats would mean inventing fields, so
`YARD_SHIPPING_PROVIDER=topship` is refused at boot with that reason. To add it: get the docs from
Topship, write `providers/topship-core.ts` (parsing, signature) and `providers/topship.ts` (HTTP)
implementing `CourierProvider` (`providers/courier-types.ts`), register it in `providers/courier.ts`
and `courier-config.ts` (`TOPSHIP_API_KEY`), and add a mock like `scripts/checks/shipbubble-mock.mjs`.

## Code map

| Area | Files |
| - | - |
| Provider interface, config, adapter | `src/server/shipping/providers/courier-types.ts`, `courier-config.ts`, `courier.ts`, `shipbubble-core.ts` (pure), `shipbubble.ts` (HTTP) |
| Rules (pure) | `src/server/shipping/courier-core.ts` |
| Live rates, price hold, fallback | `src/server/shipping/courier-quote.ts`, `quote.ts` (`quoteBrand`) |
| Pickup address | `src/server/shipping/courier-settings.ts`, `PUT /api/studio/shipping/courier`, `src/components/studio/shipping/courier-pickup.tsx` |
| Book pickup, tracking, label | `src/server/shipping/courier-book.ts`, `courier-label.ts`, `POST /api/studio/orders/{id}/courier/book`, `GET …/courier`, `GET …/courier/label`, `src/components/studio/shipping/order-courier-panel.tsx` |
| Webhook | `POST /api/webhooks/shipbubble`, `src/server/shipping/courier-webhook.ts` |
| Admin | `GET /api/admin/delivery/couriers`, `src/server/shipping/courier-admin.ts`, `src/components/admin/trust/couriers-panel.tsx` |
| Ledger | `postPaymentCaptured` (courierShippingMinor), `postRefund`, `postCourierBooked` in `src/server/ledger/postings.ts` |
| Data | `drizzle/0036_courier_shipping.sql`: `courier_settings`, `courier_quotes`, `courier_shipments`, `courier_events`, `catalog_products.weight_grams`, ledger account and transaction kinds, `ledger_order_money.courier_shipping_*` |
| Jobs | `shipping.courierHourly` (tracking poll, wallet alert, old quotes purge) |
| Tests and mock | `src/server/shipping/courier.test.ts`, `scripts/checks/shipbubble-mock.mjs`, `scripts/checks/shipping-e2e.mjs` |

## Costs

Shipbubble documents no per-call fee for addresses, rates, tracking or the wallet balance; the
money that moves is the courier price of each booked pickup, from the prepaid wallet, which the
shopper has already paid. Yard calls Shipbubble only from checkout for signed-in shoppers with a
full address (cached: one rates call per brand, address and parcel per hold period), on Book
pickup, on webhooks, and from the hourly job (at most 25 tracking reads and one wallet read).

## Local runs

```sh
node scripts/checks/shipbubble-mock.mjs 3249 --webhook-url http://localhost:3247/api/webhooks/shipbubble
# server env: YARD_SHIPPING_PROVIDER=shipbubble SHIPBUBBLE_API_KEY=sb_sandbox_mock_0123456789abcdef SHIPBUBBLE_API_BASE=http://127.0.0.1:3249/v1
node scripts/checks/shipping-e2e.mjs      # starts its own Shipbubble and Bachs mocks; see its header for the server env
```

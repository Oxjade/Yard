# Bachs payments

Yard can take payments through [Bachs](https://docs.bachs.io) hosted checkout instead of Paystack.

**Payout model A.** Bachs collects every sale into Yard's own Bachs account. Yard's ledger records
what each brand is owed, and Yard's payout runs pay brands. Bachs Connect, connected accounts and
split payments are **not** used.

## Environment

Add these lines to the server's environment (`.env.production.local` or the host's secret store)
and restart:

```sh
YARD_PAYMENTS=bachs
BACHS_SECRET_KEY=sk_live_...            # Bachs dashboard › Developer Portal › API keys (live key)
BACHS_WEBHOOK_SECRET=whsec_...          # the signing secret of the webhook endpoint below
BACHS_CHARGE_CURRENCIES=NGN             # optional; default NGN. Any of NGN, GHS, KES, USD
# BACHS_API_BASE=https://api.bachs.io  # optional; this is the default for sk_live_ keys
```

| Variable | Required | Notes |
| - | - | - |
| `YARD_PAYMENTS` | yes | `bachs` turns Bachs on. Only the provider in use ever gets a key sent anywhere. |
| `BACHS_SECRET_KEY` | yes | `sk_live_…` for real money (`sk_sandbox_…` also works, against the sandbox). Needs the scopes for checkout sessions and payments (`payments:read` / write) and refunds (`refunds:write`, `refunds:read`). Admin › Finance › Bachs also reads with `balance:read`, `disputes:read` and `payouts:read`, and optionally `webhooks:read` (below); without one, only that part says the key lacks it. |
| `BACHS_WEBHOOK_SECRET` | yes in production | Without it every webhook is refused (400) and payments are confirmed only when the shopper comes back to Yard. |
| `BACHS_CHARGE_CURRENCIES` | no | Comma separated. The checkout only charges in these; shoppers browsing in another currency are shown and charged in the first one that fits. ZAR is not possible with Bachs. |
| `BACHS_API_BASE` | no | Default `https://api.bachs.io` for `sk_live_` keys, `https://sandbox-api.bachs.io` for `sk_sandbox_` keys. Must be `https://` in production. |

The configuration check (or the server at startup) lists every problem at once: a key that isn't
`sk_live_…`/`sk_sandbox_…`, a missing webhook secret, an `http://` API base, an unsupported
currency. On the server, run it from the live release as the `yard` user with `/etc/yard.env`
loaded (the release is built by CI and has no TypeScript loader, so it runs the bundled
`tools/check-env.mjs`, see docs/DEPLOY.md):

```sh
sudo runuser -u yard -- bash -c 'set -a; . /etc/yard.env; set +a; cd /home/yard/app && node tools/check-env.mjs'
```

It prints `configuration OK: production, …, payments bachs, …` and exits 0, or every problem and
exits 1. (In a development checkout: `node --conditions=react-server --import tsx scripts/check-env.mjs`.)
The startup log says `[yard] payments: bachs (live)`.

## Webhook

Register one endpoint in the Bachs Developer Portal › Webhooks › Add destination:

```
https://<domain>/api/webhooks/bachs
```

Subscribe to these events:

| Event | What Yard does |
| - | - |
| `checkout.completed` | Reads the checkout back from the Bachs API; if Bachs says it is paid, the orders are marked paid, stock is committed, the ledger is posted and the cart is cleared. |
| `collection.succeeded` | Same as `checkout.completed` (whichever arrives first wins; the other changes nothing). |
| `checkout.expired` | The payment failed: the checkout's stock hold is released. A payment that still lands later is captured and refunded automatically. |
| `refund.created`, `refund.paid`, `refund.failed` | Settle the refund Yard asked for (the order is refunded and the shopper emailed once Bachs reports `refund.paid`). |
| `collection.failed` (optional) | Recorded only: Bachs keeps the checkout open so the shopper can try again. |

Copy the endpoint's signing secret (`whsec_…`) into `BACHS_WEBHOOK_SECRET`.

How the endpoint treats a delivery:

- The `X-Bachs-Signature-V2` header (`t=…,v1=…`) is checked against the exact raw body:
  HMAC-SHA256 of `{t}.{body}` under the signing secret, compared in constant time, with `t` no more
  than 5 minutes from now. Any `v1` may match, so rotating the secret in Bachs (24-hour overlap)
  needs no downtime: deploy the new secret within the overlap. Anything else answers **400** and
  nothing is stored.
- Each event is stored once by its `evt_…` id; a redelivery answers 200 and changes nothing.
- Charge events are never trusted on their own: Yard reads the checkout session from the Bachs API
  and applies what the API says, including an exact amount and currency match (a mismatch, or a
  payment Bachs `accepted` on other terms, is held for review instead of fulfilled).
- If the API doesn't report the checkout as paid yet, Yard answers 500 so Bachs delivers again.
- Every event shows in Admin › Finance › Orders › **Payment events**, where it can be replayed.

## How a payment runs

1. The shopper places the order. Yard creates the orders (unpaid), holds the stock for 30 minutes
   and creates a Bachs checkout session: the exact total as a decimal string (`"24691.34"`, never
   minor units), the currency, Yard's payment reference as the Bachs `reference`, the Yard checkout
   and payment ids in `metadata`, an `Idempotency-Key`, and a lifetime matching the stock hold.
2. The shopper is sent to Bachs' hosted page. Card details are only ever typed there. The method
   chosen on Yard limits the page to that corridor:

   | Charge currency | Methods offered on Yard | Bachs corridor |
   | - | - | - |
   | NGN | Card, Bank transfer | `NGN_CARD`, `NGN_BANK_TRANSFER` |
   | USD | Card | `USD_CARD` |
   | GHS | Mobile money | `MOMO_GHS` |
   | KES | Mobile money | `MOMO_KES` |

3. Bachs sends the shopper back to `/checkout/confirmation?group={id}&paid=1` (success and cancel),
   which asks Bachs for the checkout's state while it waits for the webhook. (On a local machine
   these return URLs are left out, because Bachs refuses `localhost`.)
4. The webhook confirms the payment as above. The 5-minute expiry job also asks Bachs before it
   releases an unpaid checkout.

## Refunds — one per payment

Bachs takes **one refund per charge** (a failed refund doesn't count). Yard enforces this before
anything is sent:

- The first refund on a payment (full or partial) goes to Bachs (`POST /v1/refunds` with the
  `charge_id`, a unique `reference` = Yard's refund id, and an idempotency key).
- Any second refund on the same payment is refused with **422**: *"Bachs allows only one refund per
  payment, and this payment already has one. Refund the rest by hand (from the Bachs dashboard or
  by bank transfer) and record it."* One checkout with several brands is one payment, so refunding
  one brand's order uses up the refund for the whole checkout.
- A partial refund is asked for in the currency the payment settled in. Bachs holds only NGN and
  USD, so GHS and KES payments can only be refunded in full from Yard.
- NGN **bank transfer** payments can't be refunded through Bachs at all; Bachs refuses and the
  refund shows as failed. Refund those by bank transfer.

## Payouts to brands

Payout runs don't send anything through Bachs: running a batch leaves each payout **approved**
with `manual_payout_required`. Withdraw from the Bachs balance and pay brands as you do today, then
record it. (Bachs balances are in USD and NGN; other currencies are converted when they settle.)

Why not through Bachs: a Bachs payout (`POST /v1/payouts`) can only go to a payout destination that
**belongs to the account holder** (Yard's own bank accounts; docs.bachs.io › Payouts › How payouts
work). Paying a third party from the balance is Bachs Connect: a recipient account per brand (with
its own identity checks), `POST /v1/transfers` to it, and a payout from that account. Payout model A
doesn't use Connect, so brand payouts stay manual.

## Disputes

`dispute.created` / `dispute.updated` are recorded in the event log only. Answer them in the Bachs
dashboard.

## Admin › Finance › Bachs (read-only)

Admin › Finance › **Bachs** shows what the Bachs dashboard shows, so day-to-day checks don't need
it: Owner and Finance roles only (others get 403, like the rest of Finance). The server reads Bachs
with the configured key (`paymentsConfig()`, the same client as checkout); the browser never talks to
Bachs and the key is never shown. Each Bachs answer is cached for **60 s** per server process (a
failure for 20 s), so any number of admins costs at most about eight Bachs reads a minute, well inside
the rate limit. A timeout (8 s) or an error shows "Bachs unavailable" in that part only; Yard's own
figures and the rest of Finance keep working. With `YARD_PAYMENTS=off`, the stub or Paystack it
reads nothing and says "Bachs isn't connected".

There is **no money-moving action** here: no withdrawal, transfer or refund. Refunds stay in Orders
as before; withdrawals and dispute answers are made in the Bachs dashboard.

| Part | Bachs endpoint (GET) | Scope |
| - | - | - |
| Connection: live or sandbox key, key valid, account active / not activated, webhook secret set | `/v1/accounts/me` (+ every read below: `UNAUTHORIZED`, `ACCOUNT_NOT_ACTIVATED`) | none listed |
| Live balance per currency (available, pending), settlements still to come | `/v1/balances` | `balance:read` |
| Recent payments and collections (status, amount, method, fee, date), linked to the Yard order | `/v1/payments?limit=25` | `payments:read` |
| Refunds, linked to the Yard order | `/v1/refunds?limit=25` | `refunds:read` |
| Disputes, linked to the Yard order, with the response deadline | `/v1/disputes?limit=25` | `disputes:read` |
| Withdrawals (payouts out of the Bachs balance) | `/v1/payouts?limit=10` | `payouts:read` |
| Bachs' view of Yard's webhook endpoint: enabled, subscribed events, 7-day delivery counts | `/v1/webhooks/endpoints`, `/v1/webhooks/endpoints/{id}/metrics` | `webhooks:read` (optional) |

How it reads:

- **Reconciliation.** Per currency, Bachs total (available + pending) against the ledger's money at
  Bachs (`provider_clearing`), which is what Yard owes brands (pending + available + reserve + in
  payout) plus Yard's commission plus adjustments. Any difference is flagged as a **mismatch**
  (typically Bachs fees, dispute holds or a withdrawal not recorded in Yard); less than Yard owes
  brands is a **shortfall**. Bachs holds only NGN and USD: GHS and KES ledger balances are shown as
  not comparable, and the USD line notes that it includes their conversions.
- **Order links.** A Bachs payment is matched by its `reference` (Yard's payment reference),
  `source.checkout_id` (the checkout session) or charge id; a refund by its `reference` (Yard's
  refund id) or `refund_id`; a dispute by its `charge_id`.
- **Account activated.** Bachs has no read-only "approved for live payments" flag. The account shows
  as not activated when Bachs answers `ACCOUNT_NOT_ACTIVATED` (or `PAYMENTS_NOT_ENABLED`) to any read
  or refused Yard's latest checkout with it; otherwise active per `is_active`.
- **Disputes.** The API gives no dashboard URL per dispute, so "Open in Bachs" opens the dashboard
  (app.bachs.io) and the dispute id is shown to search for.
- **Webhook health** comes from Yard's own payment event log (last received, last processed,
  failures still open, the latest events); with `webhooks:read` it adds Bachs' side (a delivery Yard
  refused with a bad signature is never stored, so only Bachs counts it).
- Not offered by the Bachs API: a list of checkout sessions (payments cover completed ones), a
  settlements list (only `pending_settlements_by_day` on the balance), dashboard deep links.

## Going live

1. Finish Bachs account verification (a new live key answers `ACCOUNT_NOT_ACTIVATED` until then)
   and turn on the payment methods you want under Settings › Checkouts, in each currency you list
   in `BACHS_CHARGE_CURRENCIES`.
2. Create the live secret key and the webhook endpoint above; put both in the environment with
   `YARD_PAYMENTS=bachs`.
3. Run the configuration check above (`node tools/check-env.mjs` as `yard` with `/etc/yard.env`
   loaded), then restart (`sudo systemctl restart yard`). Check the startup line and
   `GET /api/checkout/options` → `{"mode":"live","provider":"bachs",…}`.
4. Place one small real order and check: the order turns paid, the event shows under Payment
   events as processed, the ledger shows the capture. Refund it from Studio and check `refund.paid`
   arrives.

## Testing without Bachs

`scripts/checks/bachs-mock.mjs` is a local mock of the endpoints Yard uses, with shapes from the
Bachs docs (it moves no money), including the read endpoints Admin › Finance › Bachs uses
(`node scripts/checks/bachs-mock.mjs 3248 --seed --fee-bps 150` adds a sample dispute, failed
refund and withdrawal, and a Bachs fee so the reconciliation shows a mismatch). `scripts/checks/bachs-e2e.mjs` runs it in-process and drives a
development server configured with `BACHS_API_BASE=http://127.0.0.1:3248` through checkout,
signed webhooks, duplicates, one refund and the refused second refund (see the header of that file
for the exact environment). Unit tests: `src/server/payments/bachs-core.test.ts` (amount
conversion, signatures, status mapping) and `src/server/payments/bachs-admin-core.test.ts` (the
Admin › Bachs view: documented response fixtures, reconciliation, cache, permission refused,
payments off), run by `npm test`.

## Limits

- One refund per payment (above).
- No ZAR; methods per currency as in the table above.
- Bachs API rate limit: 500 requests a minute per live key; Yard makes one create call per
  checkout and one read per verify.
- Rate limit on the webhook route: 600 a minute.

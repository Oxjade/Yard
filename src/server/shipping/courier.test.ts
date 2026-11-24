import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { optionFor } from "../../lib/cart"
import { absorbDecision, bookRefusal, courierOptionKey, eventForCourierStatus, mergeCourierOptions, pickupDateFor, shipmentStateFor, tokenUsable } from "./courier-core"
import { readCourierConfig } from "./providers/courier-config"
import { CourierError } from "./providers/courier-types"
import {
  furthestStatus,
  mapShipbubbleStatus,
  nairaToKobo,
  parseBooking,
  parseEtaDays,
  parseRates,
  parseTracking,
  parseValidatedAddress,
  parseWallet,
  parseWebhookBody,
  pickCategory,
  ratesBody,
  shipbubbleKeyKind,
  verifyShipbubbleSignature,
  webhookEventKey,
} from "./providers/shipbubble-core"

/*
 * Courier shipping (docs/SHIPPING.md): the Shipbubble adapter's parsing on fixtures shaped like the
 * documented answers, the webhook signature and status mapping, configuration, the checkout
 * fallback rule, booking rules, and the ledger keeping courier shipping out of a brand's balance
 * (on a real in-memory database with every migration, in a child under the react-server condition
 * because the ledger is server-only). Idempotent booking and permissions run end to end in
 * scripts/checks/shipping-e2e.mjs against the mock.
 */

const SELF = fileURLToPath(import.meta.url)
const CHILD = process.env.COURIER_LEDGER_CHILD

/* ---------- Fixtures, from the docs' examples ---------- */

const ratesFixture = {
  status: "success",
  message: "Retrieved successfully",
  data: {
    request_token: "2d4a7f0d9b1c6e3a8f5b4c2d1e0f9a8b",
    couriers: [
      {
        courier_id: "gigl",
        courier_name: "GIG Logistics",
        courier_image: "https://res.cloudinary.com/shipbubble/image/upload/v1/couriers/gigl.png",
        service_code: "gigl",
        insurance: { code: null, fee: 0 },
        discount: { percentage: 0, symbol: "%", discounted: 0 },
        service_type: "pickup",
        waybill: false,
        on_demand: false,
        is_cod_available: false,
        tracking_level: 7,
        ratings: 4.5,
        votes: 120,
        connected_account: false,
        rate_card_amount: 3300,
        rate_card_currency: "NGN",
        pickup_eta: "Within 24 hrs",
        pickup_eta_time: "2026-11-25T10:00:00.000Z",
        dropoff_station: null,
        pickup_station: null,
        delivery_eta: "Within 2 - 4 working days",
        delivery_eta_time: "2026-11-28T10:00:00.000Z",
        info: null,
        currency: "NGN",
        vat: 247.5,
        total: 3547.5,
        tracking: { bars: 4, label: "Good tracking" },
      },
      { courier_id: "kwik", courier_name: "Kwik Delivery", courier_image: "not a url", service_code: "kwik", service_type: "pickup", rate_card_amount: "2450", currency: "NGN", vat: "183.75", total: "2633.75", delivery_eta: "Within 24 hrs" },
      // Unreadable (no amount): left out, not guessed.
      { courier_id: "broken", courier_name: "Broken", service_code: "broken", total: null },
      // A duplicate of the first: kept once.
      { courier_id: "gigl", courier_name: "GIG Logistics", service_code: "gigl", total: 3547.5 },
    ],
    fastest_courier: null,
    cheapest_courier: null,
    checkout_data: { ship_from: { name: "Lagos Static" }, ship_to: { name: "Ada" }, currency: "NGN", package_amount: 45000, package_weight: 1, pickup_date: "2026-11-25", is_invoice_required: false },
  },
}

const shipmentFixture = {
  order_id: "SB-7A2F91C0D4",
  courier: { name: "GIG Logistics", email: "support@giglogistics.com", phone: "+2348000000000", tracking_code: "GIGL7731002841", tracking_message: "Track with GIG", rider_info: null },
  status: "pending",
  ship_from: { name: "Lagos Static", phone: "+2348011111111", email: "ship@lagosstatic.ng", address: "12 Bode Thomas St, Surulere, Lagos" },
  ship_to: { name: "Ada Obi", phone: "+2348022222222", email: "ada@example.com", address: "4 Admiralty Way, Lekki, Lagos" },
  payment: { shipping_fee: 3547.5, type: "wallet", status: "completed", currency: "NGN" },
  items: [],
  tracking_url: "https://shipbubble.com/track/SB-7A2F91C0D4",
  date: "2026-11-24T12:00:00.000Z",
}

/* ---------- Adapter parsing ---------- */

if (!CHILD) {
  describe("Shipbubble adapter: parsing documented answers", () => {
    it("naira amounts (numbers or strings) become exact kobo; anything else is null", () => {
      assert.equal(nairaToKobo(3547.5), 354_750)
      assert.equal(nairaToKobo("2633.75"), 263_375)
      assert.equal(nairaToKobo("1,250.5"), 125_050)
      assert.equal(nairaToKobo(0.1 + 0.2), 30)
      assert.equal(nairaToKobo("2.005"), 201, "half up on the third decimal")
      assert.equal(nairaToKobo(-1), null)
      assert.equal(nairaToKobo("abc"), null)
      assert.equal(nairaToKobo(null), null)
    })

    it("rates: the request token, couriers cheapest first, unreadable and duplicate couriers left out", () => {
      const q = parseRates(ratesFixture)
      assert.equal(q.requestToken, "2d4a7f0d9b1c6e3a8f5b4c2d1e0f9a8b")
      assert.equal(q.currency, "NGN")
      assert.deepEqual(q.rates.map((r) => [r.courierId, r.amountMinor]), [["kwik", 263_375], ["gigl", 354_750]])
      const gig = q.rates[1]
      assert.equal(gig.courierName, "GIG Logistics")
      assert.equal(gig.deliveryEta, "Within 2 - 4 working days")
      assert.deepEqual(gig.transitDays, [2, 4])
      assert.equal(gig.serviceType, "pickup")
      assert.match(gig.courierImage!, /^https:\/\//)
      assert.equal(q.rates[0].courierImage, null, "a courier_image that isn't a URL is dropped")
      assert.deepEqual(q.rates[0].transitDays, [1, 1])
    })

    it("a failed or unreadable rates answer throws (never an empty success)", () => {
      assert.throws(() => parseRates({ status: "failed", message: "Invalid sender address code" }), /Invalid sender address code/)
      assert.throws(() => parseRates({ status: "success", data: { couriers: [] } }), /request_token/)
      assert.throws(() => parseRates("<html>"), /isn't a JSON object/)
    })

    it("the fetch_rates body uses Shipbubble's field names (reciever, sic), kg and naira", () => {
      const b = ratesBody({ senderCode: "18266419", receiverCode: "18266420", pickupDate: "2026-11-25", categoryId: "98190590", items: [{ name: "Danfo Hoodie", description: "Danfo Hoodie", unitWeightGrams: 450, unitAmountMinor: 4_500_000, quantity: 2 }], lengthCm: 30, widthCm: 25, heightCm: 10 })
      assert.deepEqual(b, {
        sender_address_code: 18266419,
        reciever_address_code: 18266420,
        pickup_date: "2026-11-25",
        category_id: 98190590,
        package_items: [{ name: "Danfo Hoodie", description: "Danfo Hoodie", unit_weight: "0.45", unit_amount: "45000.00", quantity: "2" }],
        package_dimension: { length: 30, width: 25, height: 10 },
      })
    })

    it("ETA words become business days when they say days or hours", () => {
      assert.deepEqual(parseEtaDays("Within 2 - 4 working days"), [2, 4])
      assert.deepEqual(parseEtaDays("Within 24 hrs"), [1, 1])
      assert.deepEqual(parseEtaDays("48 hours"), [2, 2])
      assert.deepEqual(parseEtaDays("1 week"), [5, 5])
      assert.deepEqual(parseEtaDays("Same day"), [0, 1])
      assert.equal(parseEtaDays("Soon"), null)
      assert.equal(parseEtaDays(null), null)
    })

    it("address validation, categories and wallet", () => {
      assert.deepEqual(parseValidatedAddress({ status: "success", data: { address_code: 18266419, formatted_address: "12 Bode Thomas St, Surulere, Lagos, Nigeria" } }), { code: "18266419", formatted: "12 Bode Thomas St, Surulere, Lagos, Nigeria" })
      assert.throws(() => parseValidatedAddress({ status: "success", data: {} }), /address_code/)
      assert.equal(pickCategory({ status: "success", data: [{ category_id: 74794423, category: "Hot food" }, { category_id: 98190590, category: "Fashion wears" }] }), "98190590")
      assert.equal(pickCategory({ status: "success", data: [{ category_id: 1, category: "Hot food" }] }), "1", "the first when none is fashion")
      assert.deepEqual(parseWallet({ status: "success", data: { balance: 80124.2, currency: "NGN" } }), { amountMinor: 8_012_420, currency: "NGN" })
    })

    it("a booking: provider order id, tracking, fee from payment.shipping_fee", () => {
      const b = parseBooking({ status: "success", message: "Shipment label created successfully", data: shipmentFixture })
      assert.deepEqual(b, { providerOrderId: "SB-7A2F91C0D4", status: "pending", providerStatus: "pending", courierName: "GIG Logistics", trackingCode: "GIGL7731002841", trackingUrl: "https://shipbubble.com/track/SB-7A2F91C0D4", labelUrl: null, costMinor: 354_750, currency: "NGN" })
      const withWaybill = parseBooking({ status: "success", data: { ...shipmentFixture, waybill_document: "https://example.com/waybill.pdf" } })
      assert.equal(withWaybill.labelUrl, "https://example.com/waybill.pdf")
    })

    it("tracking reads the shipment from data.results", () => {
      const t = parseTracking({ status: "success", data: { results: [{ ...shipmentFixture, status: "in_transit", package_status: [{ status: "Picked up", datetime: "2026-11-25T09:00:00Z" }, { status: "In transit", datetime: "2026-11-25T15:00:00Z" }] }] } }, "SB-7A2F91C0D4")
      assert.equal(t.status, "in_transit")
      assert.equal(t.occurredAt, "2026-11-25T15:00:00.000Z")
      assert.throws(() => parseTracking({ status: "success", data: { results: [] } }, "SB-X"), /not found/)
    })
  })

  describe("Shipbubble webhooks: signature and status mapping", () => {
    const key = "sb_sandbox_0123456789abcdef"
    const body = JSON.stringify({ event: "shipment.status.changed", ...shipmentFixture, status: "completed", package_status: [{ status: "completed", datetime: "2026-11-27T11:00:00Z" }] })
    const sig = createHmac("sha512", key).update(body).digest("hex")

    it("x-ship-signature is hex HMAC-SHA512 of the raw body under the key; anything else is refused", () => {
      assert.equal(verifyShipbubbleSignature(body, sig, [key]), true)
      assert.equal(verifyShipbubbleSignature(body, sig.toUpperCase(), [key]), true, "hex case doesn't matter")
      assert.equal(verifyShipbubbleSignature(body, sig, ["sb_sandbox_another_key_000000"]), false)
      assert.equal(verifyShipbubbleSignature(`${body} `, sig, [key]), false, "the exact raw body")
      assert.equal(verifyShipbubbleSignature(body, null, [key]), false)
      assert.equal(verifyShipbubbleSignature(body, "abc", [key]), false)
      assert.equal(verifyShipbubbleSignature(body, sig, []), false, "no secret, nothing verifies")
      assert.equal(verifyShipbubbleSignature(body, sig, ["whsec_override_secret", key]), true, "any configured secret may match")
    })

    it("the body is parsed flat; retries of the same body share one event key", () => {
      const w = parseWebhookBody(body)
      assert.equal(w.event, "shipment.status.changed")
      assert.equal(w.providerOrderId, "SB-7A2F91C0D4")
      assert.equal(w.status, "delivered")
      assert.equal(webhookEventKey(body), webhookEventKey(body))
      assert.notEqual(webhookEventKey(body), webhookEventKey(body.replace("completed", "cancelled")))
      assert.throws(() => parseWebhookBody("{}"), /order_id/)
    })

    it("Shipbubble's six statuses map to Yard's; free text is read defensively", () => {
      assert.deepEqual(["pending", "confirmed", "picked_up", "in_transit", "completed", "cancelled"].map(mapShipbubbleStatus), ["pending", "confirmed", "picked_up", "in_transit", "delivered", "cancelled"])
      assert.equal(mapShipbubbleStatus("Picked Up"), "picked_up")
      assert.equal(mapShipbubbleStatus("Out for delivery"), "in_transit")
      assert.equal(mapShipbubbleStatus("canceled"), "cancelled")
      assert.equal(mapShipbubbleStatus("weird"), "unknown")
      // The top-level status may lag behind package_status: the furthest step wins.
      assert.equal(furthestStatus(["pending", "in_transit", "picked_up"]), "in_transit")
      assert.equal(furthestStatus(["in_transit", "delivered"]), "delivered")
      assert.equal(furthestStatus(["confirmed", "cancelled"]), "cancelled")
      assert.equal(furthestStatus(["unknown"]), "unknown")
    })

    it("each courier step adds one shipment event, in order, never after delivery", () => {
      assert.equal(eventForCourierStatus("pending", ["shipped"]), null)
      assert.equal(eventForCourierStatus("picked_up", ["shipped"]), "in_transit")
      assert.equal(eventForCourierStatus("in_transit", ["shipped", "in_transit"]), null, "a repeat changes nothing")
      assert.equal(eventForCourierStatus("in_transit", []), "shipped")
      assert.equal(eventForCourierStatus("delivered", ["shipped"]), "delivered")
      assert.equal(eventForCourierStatus("delivered", ["shipped", "delivered"]), null)
      assert.equal(eventForCourierStatus("cancelled", ["shipped"]), "exception")
      assert.equal(eventForCourierStatus("cancelled", ["shipped", "exception"]), null)
      assert.equal(shipmentStateFor("booked", "picked_up"), "in_transit")
      assert.equal(shipmentStateFor("in_transit", "delivered"), "delivered")
      assert.equal(shipmentStateFor("delivered", "in_transit"), "delivered", "never backwards")
      assert.equal(shipmentStateFor("booked", "pending"), "booked")
    })
  })

  describe("configuration (env only)", () => {
    const dev = { dev: false }
    it("off unless YARD_SHIPPING_PROVIDER says otherwise", () => {
      const r = readCourierConfig({}, dev)
      assert.equal(r.config.provider, "off")
      assert.deepEqual(r.problems, [])
    })
    it("shipbubble needs a Shipbubble-shaped key; sandbox keys are marked", () => {
      assert.match(readCourierConfig({ YARD_SHIPPING_PROVIDER: "shipbubble" }, dev).problems[0], /needs SHIPBUBBLE_API_KEY/)
      assert.match(readCourierConfig({ YARD_SHIPPING_PROVIDER: "shipbubble", SHIPBUBBLE_API_KEY: "sk_live_123456789012" }, dev).problems[0], /sb_prod_/)
      const live = readCourierConfig({ YARD_SHIPPING_PROVIDER: "shipbubble", SHIPBUBBLE_API_KEY: "sb_prod_abcdefghijklmnop" }, dev)
      assert.equal(live.config.provider, "shipbubble")
      assert.equal(live.config.shipbubble?.sandbox, false)
      assert.equal(live.config.shipbubble?.apiBase, "https://api.shipbubble.com/v1")
      assert.deepEqual(live.config.shipbubble?.webhookSecrets, ["sb_prod_abcdefghijklmnop"], "Shipbubble signs with the API key")
      assert.equal(shipbubbleKeyKind("sb_sandbox_abcdefghij"), "sandbox")
    })
    it("an http:// API base only for development or YARD_ALLOW_HTTP; topship and typos are refused", () => {
      const env = { YARD_SHIPPING_PROVIDER: "shipbubble", SHIPBUBBLE_API_KEY: "sb_sandbox_abcdefghij", SHIPBUBBLE_API_BASE: "http://127.0.0.1:3249/v1" }
      assert.match(readCourierConfig(env, dev).problems[0], /https/)
      assert.equal(readCourierConfig(env, { dev: true }).config.shipbubble?.apiBase, "http://127.0.0.1:3249/v1")
      assert.equal(readCourierConfig(env, { dev: false, allowHttp: true }).problems.length, 0)
      assert.match(readCourierConfig({ YARD_SHIPPING_PROVIDER: "topship" }, dev).problems[0], /Topship/)
      assert.match(readCourierConfig({ YARD_SHIPPING_PROVIDER: "dhl" }, dev).problems[0], /off, shipbubble or topship/)
      assert.match(readCourierConfig({ YARD_COURIER_QUOTE_MINUTES: "500" }, dev).problems[0], /5 to 120/)
    })
  })

  describe("checkout: courier options and the fallback", () => {
    const manual = [
      { service: "standard", available: true, key: "standard", label: "Standard" },
      { service: "express", available: true, key: "express", label: "Express" },
      { service: "pickup", available: true, key: "pickup", label: "Pick up in Yaba" },
    ]
    const live = [
      { service: "standard", available: true, key: courierOptionKey("kwik", "kwik"), label: "Kwik Delivery" },
      { service: "standard", available: true, key: courierOptionKey("gigl", "gigl"), label: "GIG Logistics" },
    ]
    it("live courier rates replace the brand's parcel rates; store pickup stays", () => {
      assert.deepEqual(mergeCourierOptions(manual, live).map((o) => o.key), ["c:kwik:kwik", "c:gigl:gigl", "pickup"])
    })
    it("no courier answer (off, down, nothing returned): the brand's own rates, unchanged", () => {
      assert.equal(mergeCourierOptions(manual, []), manual)
    })
    it("the shopper's pick is found by key; a pick that's gone falls back to the default", () => {
      const opts = mergeCourierOptions(manual, live).map((o) => ({ ...o, methodId: o.key, price: { amount: 1, currency: "NGN" }, free: false, transit: [1, 2] as [number, number], providerId: "x", guaranteed: false as const, courier: o.key.startsWith("c:") ? { name: o.label, image: null, eta: null, expiresAt: "" } : undefined })) as Parameters<typeof optionFor>[0]
      assert.equal(optionFor(opts, "c:gigl:gigl")?.key, "c:gigl:gigl")
      assert.equal(optionFor(opts, "pickup")?.key, "pickup")
      assert.equal(optionFor(opts, "c:dhl:dhl")?.key, "c:kwik:kwik", "the cheapest courier when the chosen one is gone")
      assert.equal(optionFor(opts, "express")?.key, "c:kwik:kwik", "a manual service the courier replaced falls back too")
      assert.equal(optionFor(manual.map((o) => ({ ...o, methodId: o.key, price: { amount: 1, currency: "NGN" }, free: false, transit: [1, 2] as [number, number], providerId: "manual", guaranteed: false as const })) as Parameters<typeof optionFor>[0], "express")?.key, "express")
    })
  })

  describe("booking rules", () => {
    const quoted = { courier: { quoteId: "cq_1" } }
    it("only a paid, unshipped order that paid a courier rate can book", () => {
      assert.equal(bookRefusal({ status: "paid", paid: true }, quoted), null)
      assert.equal(bookRefusal({ status: "processing", paid: true }, quoted), null)
      assert.match(bookRefusal({ status: "paid", paid: true }, { }) ?? "", /courier rate/)
      assert.match(bookRefusal({ status: "pending_payment", paid: false }, quoted) ?? "", /isn't paid/)
      assert.match(bookRefusal({ status: "shipped", paid: true }, quoted) ?? "", /already shipped/)
      assert.match(bookRefusal({ status: "cancelled", paid: true }, quoted) ?? "", /cancelled/)
    })
    it("the request token is reused while the provider honours it and its pickup day hasn't passed", () => {
      const now = Date.parse("2026-11-24T10:00:00Z")
      assert.equal(tokenUsable({ tokenExpiresAt: new Date(now + 86_400_000), pickupDate: "2026-11-25" }, now, "Africa/Lagos"), true)
      assert.equal(tokenUsable({ tokenExpiresAt: new Date(now + 86_400_000), pickupDate: "2026-11-23" }, now, "Africa/Lagos"), false, "pickup day passed")
      assert.equal(tokenUsable({ tokenExpiresAt: new Date(now - 1), pickupDate: null }, now, "Africa/Lagos"), false, "token expired")
    })
    it("pickup is a weekday after the handling time, within Shipbubble's 7 days", () => {
      assert.equal(pickupDateFor(Date.parse("2026-11-24T10:00:00Z"), "Africa/Lagos", 1), "2026-11-25") // Tue → Wed
      assert.equal(pickupDateFor(Date.parse("2026-11-27T10:00:00Z"), "Africa/Lagos", 1), "2026-11-30") // Fri → Mon
      assert.equal(pickupDateFor(Date.parse("2026-11-24T10:00:00Z"), "Africa/Lagos", 2), "2026-11-26")
      assert.equal(pickupDateFor(Date.parse("2026-11-24T10:00:00Z"), "Africa/Lagos", 30), "2026-11-30", "capped")
    })
    it("Yard absorbs a re-quote's price rise; above the cap Admin is alerted", () => {
      assert.deepEqual(absorbDecision(300_000, 350_000, 100_000), { diffMinor: 50_000, overCap: false })
      assert.deepEqual(absorbDecision(300_000, 450_000, 100_000), { diffMinor: 150_000, overCap: true })
      assert.deepEqual(absorbDecision(300_000, 280_000, 100_000), { diffMinor: -20_000, overCap: false })
    })
    it("only a booking call that may have reached the courier is ambiguous", () => {
      assert.equal(new CourierError("x", "unavailable").ambiguous, true)
      assert.equal(new CourierError("x", "refused", 400).ambiguous, false)
      assert.equal(new CourierError("x", "auth", 401).ambiguous, false)
    })
  })

  describe("ledger: courier shipping is Yard's, never the brand's (real database)", () => {
    it("brand owed balance excludes courier shipping; commission is on the brand's part; refunds take the brand's part first", () => {
      const out = execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", SELF], {
        env: { ...process.env, COURIER_LEDGER_CHILD: "1", NODE_ENV: "test", NODE_TEST_CONTEXT: "" },
        encoding: "utf8",
        timeout: 120_000,
      })
      const line = out.split("\n").find((l) => l.startsWith("RESULT "))
      assert.ok(line, `child printed no result:\n${out.slice(-2000)}`)
      const r = JSON.parse(line.slice(7))
      // Order 1: ₦50,000 of items + ₦2,500 courier shipping. Order 2: ₦10,000 + ₦300 of the brand's own shipping.
      assert.equal(r.afterCapture.brandOwed, 4_750_000 + 978_500, "brand: items less 5% commission, plus its own (manual) shipping; no courier money")
      assert.equal(r.afterCapture.shippingCollected, 250_000)
      assert.equal(r.afterCapture.commission, 250_000 + 51_500, "5% of ₦50,000 (not ₦52,500) + 5% of ₦10,300")
      assert.equal(r.afterCapture.clearing, 5_250_000 + 1_030_000, "all of it is at the payment provider")
      assert.equal(r.orderMoney.courierShippingMinor, 250_000)
      assert.equal(r.afterBooking.shippingSpent, 270_000)
      assert.equal(r.afterBooking.courierWallet, -270_000, "paid from the courier wallet, which is topped up outside Yard")
      assert.equal(r.afterBooking.brandOwed, r.afterCapture.brandOwed, "booking doesn't touch the brand")
      assert.equal(r.afterBooking.clearing, r.afterCapture.clearing, "nor the payment provider's balance")
      assert.equal(r.bookingTwice, 1, "one ledger transaction per shipment")
      assert.equal(r.afterPartialRefund.shippingCollected, 250_000, "a ₦10,000 refund is the brand's")
      assert.equal(r.afterPartialRefund.brandOwed, r.afterCapture.brandOwed - 950_000)
      assert.equal(r.afterFullRefund.shippingCollected, 0, "the rest of a full refund returns the courier shipping")
      assert.equal(r.afterFullRefund.brandOwed, 978_500, "order 1 is gone from the brand; order 2 stays")
      assert.equal(r.afterFullRefund.commission, 51_500)
      assert.equal(r.afterFullRefund.orderStatus, "refunded")
      assert.equal(r.overRefund, true, "never more than was paid")
      assert.equal(r.balanced, true, "every transaction balances")
    })
  })
}

/* ---------- Child: the ledger on PGlite (react-server, so server-only modules load) ---------- */

async function ledgerChild() {
  const path = await import("node:path")
  const { PGlite } = await import("@electric-sql/pglite")
  const { drizzle } = await import("drizzle-orm/pglite")
  const { migrate } = await import("drizzle-orm/pglite/migrator")
  const { and, eq, sql } = await import("drizzle-orm")
  const { brands } = await import("../db/schema/brands")
  const { ledgerAccounts, ledgerBrandSettings, ledgerOrderMoney, ledgerTransactions } = await import("../db/schema/ledger")
  const { postPaymentCaptured, postRefund, postCourierBooked } = await import("../ledger/postings")

  const pg = new PGlite()
  const d = drizzle(pg)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  await d.insert(brands).values({ id: "b_ls", handle: "ls", name: "Lagos Static", city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true })
  await d.insert(ledgerBrandSettings).values({ brandId: "b_ls", commissionBpsOverride: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the ledger takes the app's Tx; a PGlite transaction has the same query API
  const tx = <T>(fn: (t: any) => Promise<T>) => d.transaction((t) => fn(t))
  const bal = async (ownerKind: "brand" | "platform", kinds: string[]) => {
    const rows = await d.select({ kind: ledgerAccounts.kind, b: ledgerAccounts.balanceMinor }).from(ledgerAccounts).where(and(eq(ledgerAccounts.ownerKind, ownerKind), eq(ledgerAccounts.currency, "NGN")))
    return rows.filter((r) => kinds.includes(r.kind)).reduce((s, r) => s + r.b, 0)
  }
  const snapshot = async () => ({
    brandOwed: await bal("brand", ["brand_pending", "brand_available", "brand_reserve", "brand_payout_hold"]),
    shippingCollected: await bal("platform", ["shipping_collected"]),
    shippingSpent: await bal("platform", ["shipping_spent"]),
    courierWallet: await bal("platform", ["courier_wallet"]),
    commission: await bal("platform", ["platform_commission"]),
    clearing: await bal("platform", ["provider_clearing"]),
  })

  await tx((t) => postPaymentCaptured(t, { paymentId: "pay_1", orderId: "or_1", brandId: "b_ls", currency: "NGN", grossMinor: 5_250_000, courierShippingMinor: 250_000 }))
  await tx((t) => postPaymentCaptured(t, { paymentId: "pay_1", orderId: "or_2", brandId: "b_ls", currency: "NGN", grossMinor: 1_030_000 }))
  const afterCapture = await snapshot()
  const [orderMoney] = await d.select().from(ledgerOrderMoney).where(eq(ledgerOrderMoney.orderId, "or_1"))

  await tx((t) => postCourierBooked(t, { shipmentId: "cs_1", orderId: "or_1", brandId: "b_ls", currency: "NGN", costMinor: 270_000 }))
  await tx((t) => postCourierBooked(t, { shipmentId: "cs_1", orderId: "or_1", brandId: "b_ls", currency: "NGN", costMinor: 270_000 }))
  const afterBooking = await snapshot()
  const bookingTwice = (await d.select().from(ledgerTransactions).where(eq(ledgerTransactions.kind, "courier_booked"))).length

  await tx((t) => postRefund(t, { refundId: "rf_1", orderId: "or_1", brandId: "b_ls", currency: "NGN", amountMinor: 1_000_000 }))
  const afterPartialRefund = await snapshot()
  let overRefund = false
  try {
    await tx((t) => postRefund(t, { refundId: "rf_x", orderId: "or_1", brandId: "b_ls", currency: "NGN", amountMinor: 4_250_001 }))
  } catch {
    overRefund = true
  }
  await tx((t) => postRefund(t, { refundId: "rf_2", orderId: "or_1", brandId: "b_ls", currency: "NGN", amountMinor: 4_250_000 }))
  const [om1] = await d.select().from(ledgerOrderMoney).where(eq(ledgerOrderMoney.orderId, "or_1"))
  const afterFullRefund = { ...(await snapshot()), orderStatus: om1.status }

  const sums = await d.execute(sql`select t.id, sum(case when e.direction = 'debit' then e.amount_minor else 0 end) as dr, sum(case when e.direction = 'credit' then e.amount_minor else 0 end) as cr from ledger_transactions t join ledger_entries e on e.transaction_id = t.id group by t.id`)
  const balanced = (sums.rows as { dr: string | number; cr: string | number }[]).every((x) => Number(x.dr) === Number(x.cr))
  await pg.close()
  return { afterCapture, orderMoney, afterBooking, bookingTwice, afterPartialRefund, afterFullRefund, overRefund, balanced }
}

if (CHILD) {
  ledgerChild().then(
    (r) => process.stdout.write(`RESULT ${JSON.stringify(r)}\n`),
    (e) => {
      process.stderr.write(String(e?.stack ?? e))
      process.exit(1)
    },
  )
}

import assert from "node:assert/strict"
import path from "node:path"
import { after, before, beforeEach, describe, it } from "node:test"
import { PGlite } from "@electric-sql/pglite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { liveActivityTokenBody } from "../../lib/api/contracts/notifications"
import { brands } from "../db/schema/brands"
import { liveActivityTokens } from "../db/schema/engagement"
import { orderGroups, orderRefs } from "../db/schema/orders"
import { users } from "../db/schema/people"
import { MAX_TOKENS, ordersWithTokens, registerStartToken, registerUpdateToken, removeToken, startTokensFor, updateTokensFor, type Db } from "./live-activity-db"
import { pushToTokens, type LiveSender, type OrderSnapshot } from "./live-activity-send"
import type { LiveActivityResult, LiveState } from "./live-activity-state"

/*
 * Live Activity tokens on a real (in-memory) database with every migration applied: the endpoint's
 * rule (a shopper registers tokens on their own orders only), token moves and caps, and the send
 * loop against a fake APNs: an unchanged state isn't re-sent, delivered and cancelled end the
 * activity and drop its token, a 410 deletes the token, and a first shipment starts an activity
 * through a push-to-start token.
 */

let pg: PGlite
let d: ReturnType<typeof drizzle>
const db = () => d as unknown as Db
const tok = (n: number) => n.toString(16).padStart(64, "0")

before(async () => {
  pg = new PGlite()
  d = drizzle(pg)
  await migrate(d, { migrationsFolder: path.join(process.cwd(), "drizzle") })
  await d.insert(users).values([
    { id: "u_ada", kind: "shopper", name: "Ada", email: "ada@example.test" },
    { id: "u_bob", kind: "shopper", name: "Bob", email: "bob@example.test" },
  ])
  await d.insert(brands).values({ id: "b_oj", handle: "oj", name: "Ojuelegba Supply", city: "Lagos", citySlug: "lagos", country: "NG", currency: "NGN", categories: ["streetwear"], followersBase: 0, timeZone: "Africa/Lagos", reviewStatus: "verified", verified: true })
  await d.insert(orderGroups).values([
    { id: "og_ada", customerId: "u_ada", reference: "YRD-ADA" },
    { id: "og_bob", customerId: "u_bob", reference: "YRD-BOB" },
  ])
  const base = { brandId: "b_oj", placedAt: new Date("2026-11-17T10:00:00Z"), status: "shipped", paid: true, currency: "NGN", subtotalMinor: 1000, shippingMinor: 0, totalMinor: 1000, items: [], shipToCountry: "GB", source: "browser" }
  await d.insert(orderRefs).values([
    { ...base, id: "or_ada", groupId: "og_ada", reference: "YRD-ADA-1", customerId: "u_ada" },
    { ...base, id: "or_ada2", groupId: "og_ada", reference: "YRD-ADA-2", customerId: "u_ada" },
    { ...base, id: "or_bob", groupId: "og_bob", reference: "YRD-BOB-1", customerId: "u_bob" },
  ])
})
after(async () => {
  await pg.close()
})
beforeEach(async () => {
  await d.delete(liveActivityTokens)
})

describe("Registering tokens (POST/DELETE /api/orders/{id}/live-activity)", () => {
  it("own orders only: another shopper's order or an unknown id stores nothing", async () => {
    assert.equal(await registerUpdateToken(db(), "u_ada", "or_bob", { token: tok(1) }), false)
    assert.equal(await registerUpdateToken(db(), "u_ada", "or_nope", { token: tok(1) }), false)
    assert.equal((await d.select().from(liveActivityTokens)).length, 0)
    assert.equal(await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(1), timeZone: "Europe/London", appVersion: "1.0.0" }), true)
    const rows = await updateTokensFor(db(), "or_ada")
    assert.equal(rows.length, 1)
    assert.deepEqual([rows[0]!.userId, rows[0]!.kind, rows[0]!.timeZone, rows[0]!.appVersion], ["u_ada", "update", "Europe/London", "1.0.0"])
  })

  it("a token registered again moves to the new order and forgets what was sent; same order keeps it", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(2) })
    await d.update(liveActivityTokens).set({ lastState: { step: "shipped", etaMs: null, progress: 0.3, statusLine: "x" }, lastSentAt: new Date() })
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(2) })
    assert.notEqual((await updateTokensFor(db(), "or_ada"))[0]!.lastState, null)
    await registerUpdateToken(db(), "u_ada", "or_ada2", { token: tok(2) })
    assert.equal((await updateTokensFor(db(), "or_ada")).length, 0)
    const moved = await updateTokensFor(db(), "or_ada2")
    assert.equal(moved.length, 1)
    assert.equal(moved[0]!.lastState, null)
  })

  it(`keeps at most ${MAX_TOKENS} phones per order`, async () => {
    for (let i = 10; i < 10 + MAX_TOKENS + 2; i++) await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(i) })
    const rows = await updateTokensFor(db(), "or_ada")
    assert.equal(rows.length, MAX_TOKENS)
    assert.ok(!rows.some((r) => r.token === tok(10) || r.token === tok(11)))
  })

  it("unregister removes only the caller's token on that order", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(3) })
    assert.equal(await removeToken(db(), "u_bob", tok(3), { orderRefId: "or_ada" }), false)
    assert.equal(await removeToken(db(), "u_ada", tok(3), { orderRefId: "or_ada2" }), false)
    assert.equal(await removeToken(db(), "u_ada", tok(3), { orderRefId: "or_ada" }), true)
    assert.deepEqual(await ordersWithTokens(db()), [])
  })

  it("push-to-start tokens are per shopper, not per order", async () => {
    await registerStartToken(db(), "u_ada", { token: tok(4), timeZone: "Africa/Lagos" })
    assert.equal((await startTokensFor(db(), "u_ada")).length, 1)
    assert.equal((await startTokensFor(db(), "u_bob")).length, 0)
    assert.equal(await removeToken(db(), "u_bob", tok(4), { kind: "start" }), false)
    assert.equal(await removeToken(db(), "u_ada", tok(4), { kind: "start" }), true)
  })

  it("the body takes hex tokens only (lower-cased) and an IANA zone", () => {
    assert.equal(liveActivityTokenBody.parse({ token: "AB".repeat(32), timeZone: "America/Argentina/Buenos_Aires" }).token, "ab".repeat(32))
    assert.equal(liveActivityTokenBody.safeParse({ token: "not-hex" }).success, false)
    assert.equal(liveActivityTokenBody.safeParse({ token: tok(1), timeZone: "../etc" }).success, false)
    assert.equal(liveActivityTokenBody.safeParse({ token: tok(1), orderId: "x" }).success, false)
  })
})

describe("Sending (pushToTokens against a fake APNs)", () => {
  const NOW = Date.parse("2026-11-19T12:00:00Z")
  type Sent = { token: string; payload: { aps: Record<string, unknown> }; priority: number }
  const fake = (status: (token: string) => { status: number; reason?: string } = () => ({ status: 200 })) => {
    const sent: Sent[] = []
    const sender: LiveSender = {
      async send(token, payload, priority) {
        sent.push({ token, payload: payload as Sent["payload"], priority })
        const s = status(token)
        return { status: s.status, reason: s.reason ?? null, apnsId: "x" }
      },
    }
    return { sent, sender }
  }
  const counts: string[] = []
  const hooks = { count: (e: string) => void counts.push(e), warn: () => {} }
  const shipped: LiveState = { step: "shipped", etaMs: Date.parse("2026-11-22T20:00:00Z"), progress: 0.4, statusLine: "On its way from Lagos" }
  const snap = (state: LiveState | null, closed = false): OrderSnapshot => ({
    orderId: "or_ada",
    closedAs: "cancelled",
    at: (): LiveActivityResult => ({ brandName: "Ojuelegba Supply", brandCity: "Lagos", deliveryCity: "London", state, closed }),
  })
  const run = async (sender: LiveSender, s: OrderSnapshot, starts = false) =>
    pushToTokens(db(), sender, hooks, { tokens: await updateTokensFor(db(), "or_ada"), starts: starts ? await startTokensFor(db(), "u_ada") : [], snap: s, fallbackTz: "UTC", now: NOW, refresh: false })

  it("update once, then the same state is not sent again", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(20) })
    const a = fake()
    assert.equal((await run(a.sender, snap(shipped))).sent, 1)
    assert.equal(a.sent[0]!.payload.aps.event, "update")
    assert.equal(a.sent[0]!.priority, 10)
    assert.equal(a.sent[0]!.payload.aps["stale-date"], NOW / 1000 + 8 * 3600)
    assert.equal(a.sent[0]!.payload.aps["relevance-score"], 40)
    const row = (await updateTokensFor(db(), "or_ada"))[0]!
    assert.deepEqual(row.lastState, shipped)
    const b = fake()
    assert.equal((await run(b.sender, snap(shipped))).sent, 0)
    assert.equal(b.sent.length, 0)
  })

  it("410 Unregistered deletes the token", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(21) })
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(22) })
    counts.length = 0
    const a = fake((t) => (t === tok(21) ? { status: 410, reason: "Unregistered" } : { status: 200 }))
    const r = await run(a.sender, snap(shipped))
    assert.deepEqual(r, { sent: 1, removed: 1 })
    assert.deepEqual((await updateTokensFor(db(), "or_ada")).map((x) => x.token), [tok(22)])
    assert.deepEqual(counts.sort(), ["live_activity.failed", "live_activity.removed", "live_activity.sent"])
  })

  it("a server error keeps the token (sent next time)", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(23) })
    const a = fake(() => ({ status: 500, reason: "InternalServerError" }))
    assert.deepEqual(await run(a.sender, snap(shipped)), { sent: 0, removed: 0 })
    assert.equal((await updateTokensFor(db(), "or_ada"))[0]!.lastState, null)
  })

  it("delivered ends the activity, dismissed 2 hours later, and drops the token", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(24) })
    const a = fake()
    await run(a.sender, snap({ step: "delivered", etaMs: null, progress: 1, statusLine: "Delivered" }))
    assert.equal(a.sent[0]!.payload.aps.event, "end")
    assert.equal(a.sent[0]!.payload.aps["dismissal-date"], NOW / 1000 + 7200)
    assert.deepEqual(a.sent[0]!.payload.aps["content-state"], { step: "delivered", progress: 1, statusLine: "Delivered" })
    assert.equal((await updateTokensFor(db(), "or_ada")).length, 0)
  })

  it("cancelled ends it at once (dismissal in the past) and drops the token", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(25) })
    const a = fake()
    await run(a.sender, snap(null, true))
    assert.equal(a.sent[0]!.payload.aps.event, "end")
    assert.ok((a.sent[0]!.payload.aps["dismissal-date"] as number) < NOW / 1000)
    assert.equal((a.sent[0]!.payload.aps["content-state"] as { statusLine: string }).statusLine, "Cancelled by Ojuelegba Supply")
    assert.equal((await updateTokensFor(db(), "or_ada")).length, 0)
  })

  it("not shipped yet: nothing is sent", async () => {
    await registerUpdateToken(db(), "u_ada", "or_ada", { token: tok(26) })
    const a = fake()
    assert.equal((await run(a.sender, snap(null))).sent, 0)
    assert.equal(a.sent.length, 0)
  })

  it("first shipment with no activity: push-to-start with the attributes and an alert", async () => {
    await registerStartToken(db(), "u_ada", { token: tok(27) })
    const a = fake()
    assert.equal((await run(a.sender, snap(shipped), true)).sent, 1)
    const aps = a.sent[0]!.payload.aps
    assert.equal(aps.event, "start")
    assert.equal(aps["attributes-type"], "YardOrderActivityAttributes")
    assert.deepEqual(aps.attributes, { orderId: "or_ada", brandName: "Ojuelegba Supply", brandCity: "Lagos", deliveryCity: "London" })
    assert.deepEqual(aps.alert, { title: "Ojuelegba Supply shipped your order", body: "On its way from Lagos" })
    // The start token is the phone's, kept for the next order.
    assert.equal((await d.select().from(liveActivityTokens).where(eq(liveActivityTokens.kind, "start"))).length, 1)
  })
})

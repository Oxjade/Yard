import "server-only"
import { and, eq, inArray, like, sql } from "drizzle-orm"
import { ipHash } from "../../http/request"
import { log } from "../../log"
import { chartEvents, chartFlags, chartSnapshots, shopperFollows, users } from "../schema"
import { db } from "../tx"
import type { SeedModule } from "./types"

/**
 * Charts fixtures (Appendix D, cluster C), then the edition backfill (§6.3).
 *
 * 40 sample accounts u_x01…u_x40, created seedDay − 1 at 08:00 UTC, each follow three brands
 * between 21:00 and 21:10 UTC that day, from two TEST-NET addresses (25 on 203.0.113.7, 15 on
 * 203.0.113.8). Ingest's rules apply as they would to real requests: per brand, IP and day only
 * the first 3 distinct accounts count, the rest are excluded_fraud (signal_ip_cap). The detectors
 * then find the ring themselves (coordinated_ring, and ip_concentration while the server trusts
 * one proxy hop); nothing here writes a flag.
 *
 * Deviation from Appendix D: the third brand is Dune Apothecary (Nairobi), not Orun Studio. A ring
 * flag is high on every brand involved and holds it from public boards, and Orun Studio is one of
 * Lagos's three brands: holding it would leave Lagos without a City chart, which §6.3's City
 * charts default and check C6 rely on.
 */
export const RING_BRANDS = ["b_paper_riot", "b_afterhours_ceramics", "b_dune_apothecary"] as const
export const RING_ACCOUNTS = Array.from({ length: 40 }, (_, i) => `u_x${String(i + 1).padStart(2, "0")}`)
const IP_CAP = 3

const atUtc = (day: string, hh: number, mm: number, ss = 0) => new Date(`${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}Z`)
const shiftDay = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const seed: SeedModule = {
  key: "seed:charts",
  version: 1,
  requires: ["brands:b_paper_riot", "brands:b_afterhours_ceramics", "brands:b_dune_apothecary"],
  async run(ctx) {
    const d = await db()
    const ringDay = shiftDay(ctx.seedDay, -1)

    // A reseed starts clean: the ring's events and follows, the flags computed from them, and every
    // snapshot (they are derived and rewritten by the backfill below).
    const ringFlags = await d
      .select({ id: chartFlags.id })
      .from(chartFlags)
      .where(and(inArray(chartFlags.brandId, [...RING_BRANDS]), inArray(chartFlags.detector, ["coordinated_ring", "ip_concentration"]), eq(chartFlags.windowStart, ringDay)))
    await d.delete(chartEvents).where(like(chartEvents.actorId, "u\\_x%"))
    if (ringFlags.length) {
      const ids = ringFlags.map((f) => f.id)
      await d.update(chartEvents).set({ flagId: null }).where(inArray(chartEvents.flagId, ids))
      await d.delete(chartFlags).where(inArray(chartFlags.id, ids))
    }
    await d.delete(shopperFollows).where(like(shopperFollows.userId, "u\\_x%"))
    await d.delete(chartSnapshots)

    const created = atUtc(ringDay, 8, 0)
    await d
      .insert(users)
      .values(RING_ACCOUNTS.map((id) => ({ id, kind: "shopper", name: "Sample suspicious account", email: `${id.slice(2)}@example.test`, status: "active", demo: false, createdAt: created })))
      .onConflictDoNothing()

    // 40 accounts over 10 minutes: one every 14 s, three follows a second apart.
    const counted = new Map<string, Set<string>>()
    const events: (typeof chartEvents.$inferInsert)[] = []
    const follows: (typeof shopperFollows.$inferInsert)[] = []
    RING_ACCOUNTS.forEach((userId, i) => {
      const ip = i < 25 ? "203.0.113.7" : "203.0.113.8"
      RING_BRANDS.forEach((brandId, j) => {
        const at = new Date(atUtc(ringDay, 21, 0).getTime() + i * 14_000 + j * 1000)
        const hash = ipHash(ip, at)!
        const key = `${brandId}|${hash}|${ringDay}`
        const seen = counted.get(key) ?? new Set()
        counted.set(key, seen)
        const verdict = seen.size < IP_CAP ? "counted" : "excluded_fraud"
        if (verdict === "counted") seen.add(userId)
        follows.push({ userId, brandId, createdAt: at })
        events.push({ brandId, kind: "follow", actorKind: "shopper", actorId: userId, accountAgeDays: 0, ipHash: hash, uaHash: null, day: ringDay, verdict, createdAt: at })
      })
    })
    await d.insert(shopperFollows).values(follows).onConflictDoNothing()
    await d.insert(chartEvents).values(events)

    // The detectors find the ring; then the final editions movement and history read.
    const { refreshFlags, backfillFinals } = await import("../../charts")
    const flags = await refreshFlags(ctx.now.getTime())
    const { result } = await backfillFinals({ now: ctx.now.getTime(), missingOnly: false })
    const [{ n }] = await d.select({ n: sql<number>`count(*)::int` }).from(chartEvents).where(and(like(chartEvents.actorId, "u\\_x%"), eq(chartEvents.verdict, "counted")))
    log.info(
      `[yard] seed:charts ring: ${events.length} follows, ${n} still counted, ${flags.created} flags (${flags.held.join(", ") || "none held"}); backfill ${result.snapshots} snapshots, ${result.entries} entries over ${result.dates} dates in ${result.ms} ms`,
    )
  },
}

export default seed

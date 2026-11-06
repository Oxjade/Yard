/**
 * YARD Charts anti-fraud detectors (§6.3 "Anti-fraud"), as pure functions over chart events.
 *
 * Plain Node (no `server-only`, no `@/` aliases), so `score.test.ts` runs them on synthetic
 * events. `antifraud.ts` loads the events, calls these, upserts `chart_flags` and applies the
 * automatic actions. Evidence holds counts and ratios only; IP hashes are cut to 8 characters.
 */

export type ChartEvent = {
  seq: number
  brandId: string
  productId: string | null
  dropId: string | null
  kind: string
  actorId: string
  /** Whole days between the account's creation and the event; null for anonymous visitors. */
  accountAgeDays: number | null
  ipHash: string | null
  /** 'YYYY-MM-DD' (UTC). */
  day: string
  /** Epoch ms. */
  at: number
  verdict: string
}

export type Detector = "velocity_spike" | "ip_concentration" | "new_account_share" | "self_engagement" | "wishlist_churn" | "order_anomaly" | "coordinated_ring"
export type Severity = "low" | "medium" | "high"

export type Detection = {
  brandId: string
  detector: Detector
  severity: Severity
  windowStart: string
  windowEnd: string
  evidence: Record<string, number | string>
  /** Events the automatic action excludes (medium and high): the matching ones that still count. */
  eventSeqs: number[]
  /** Every event that matched the pattern, whatever its verdict (for the flag's excluded count). */
  matchSeqs: number[]
}

/** Signals that would count: real state changes and first views (not deduped or self/anon/restricted). */
const live = (e: ChartEvent) => e.verdict === "counted" || e.verdict === "excluded_fraud"
/** Signals that still count after ingest's own exclusions (the IP cap). */
const stillCounted = (e: ChartEvent) => e.verdict === "counted"
const countedOnly = (seqs: ChartEvent[]) => seqs.filter((e) => e.verdict === "counted").map((e) => e.seq)

const groupBy = <T, K>(list: readonly T[], key: (t: T) => K) => {
  const m = new Map<K, T[]>()
  for (const t of list) {
    const k = key(t)
    const arr = m.get(k)
    if (arr) arr.push(t)
    else m.set(k, [t])
  }
  return m
}

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function median(values: number[]) {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * velocity_spike: a day's follows or wishlists > max(30, 5 × the median day of the prior 28 days).
 * Medium; high when also more than 60 % came from accounts under 48 hours old. Only signals that
 * still count take part: what ingest's IP cap already excluded can't spike a board.
 */
export function velocitySpike(events: readonly ChartEvent[], days: readonly string[]): Detection[] {
  const out: Detection[] = []
  const rel = events.filter((e) => stillCounted(e) && (e.kind === "follow" || e.kind === "wishlist_add"))
  for (const [brandId, list] of groupBy(rel, (e) => e.brandId)) {
    for (const kind of ["follow", "wishlist_add"] as const) {
      const perDay = groupBy(
        list.filter((e) => e.kind === kind),
        (e) => e.day,
      )
      for (const day of days) {
        const today = perDay.get(day) ?? []
        if (!today.length) continue
        const prior: number[] = []
        for (let i = 1; i <= 28; i++) prior.push(perDay.get(addDays(day, -i))?.length ?? 0)
        const threshold = Math.max(30, 5 * median(prior))
        if (today.length <= threshold) continue
        const young = today.filter((e) => e.accountAgeDays !== null && e.accountAgeDays <= 1)
        const youngShare = young.length / today.length
        out.push({
          brandId,
          detector: "velocity_spike",
          severity: youngShare > 0.6 ? "high" : "medium",
          windowStart: day,
          windowEnd: day,
          evidence: { kind, events: today.length, threshold, priorMedian: median(prior), youngAccountShare: round2(youngShare) },
          eventSeqs: countedOnly(today.filter((e) => e.accountAgeDays !== null && e.accountAgeDays < 7)),
          matchSeqs: today.map((e) => e.seq),
        })
      }
    }
  }
  return out
}

/**
 * ip_concentration over a window: ≥ 30 events with a known IP hash and the top-3 hashes' share
 * > 0.3 (medium), > 0.6 (high). Only events whose client IP was known take part (§5.1); events the
 * ingest IP cap excluded count too, since the pattern is what this detector looks for.
 */
export function ipConcentration(events: readonly ChartEvent[], from: string, to: string): Detection[] {
  const out: Detection[] = []
  const inW = events.filter((e) => live(e) && e.ipHash && e.day >= from && e.day <= to)
  for (const [brandId, list] of groupBy(inW, (e) => e.brandId)) {
    if (list.length < 30) continue
    const byIp = [...groupBy(list, (e) => e.ipHash!)].sort((a, b) => b[1].length - a[1].length)
    const top = byIp.slice(0, 3)
    const topEvents = top.flatMap(([, l]) => l)
    const share = topEvents.length / list.length
    if (share <= 0.3) continue
    const first = topEvents.reduce((m, e) => (e.day < m ? e.day : m), to)
    const last = topEvents.reduce((m, e) => (e.day > m ? e.day : m), from)
    out.push({
      brandId,
      detector: "ip_concentration",
      severity: share > 0.6 ? "high" : "medium",
      windowStart: first,
      windowEnd: last,
      evidence: { events: list.length, topThreeShare: round2(share), distinctIps: byIp.length, topIps: top.map(([ip, l]) => `${ip.slice(0, 8)}:${l.length}`).join(" ") },
      eventSeqs: countedOnly(topEvents),
      matchSeqs: topEvents.map((e) => e.seq),
    })
  }
  return out
}

/**
 * new_account_share: on a day, ≥ 20 events and more than half from accounts under 24 hours old.
 * Medium. Like velocity_spike, it reads the signals that still count.
 */
export function newAccountShare(events: readonly ChartEvent[], days: readonly string[]): Detection[] {
  const out: Detection[] = []
  const wanted = new Set(days)
  const rel = events.filter((e) => stillCounted(e) && wanted.has(e.day) && e.accountAgeDays !== null)
  for (const [key, list] of groupBy(rel, (e) => `${e.brandId}|${e.day}`)) {
    if (list.length < 20) continue
    const fresh = list.filter((e) => e.accountAgeDays === 0)
    const share = fresh.length / list.length
    if (share <= 0.5) continue
    const [brandId, day] = key.split("|")
    out.push({ brandId, detector: "new_account_share", severity: "medium", windowStart: day, windowEnd: day, evidence: { events: list.length, newAccountShare: round2(share) }, eventSeqs: countedOnly(fresh), matchSeqs: fresh.map((e) => e.seq) })
  }
  return out
}

/** self_engagement: more than 20 excluded_self events for a brand in a day. Low (already excluded). */
export function selfEngagement(events: readonly ChartEvent[], days: readonly string[]): Detection[] {
  const wanted = new Set(days)
  const out: Detection[] = []
  for (const [key, list] of groupBy(
    events.filter((e) => e.verdict === "excluded_self" && wanted.has(e.day)),
    (e) => `${e.brandId}|${e.day}`,
  )) {
    if (list.length <= 20) continue
    const [brandId, day] = key.split("|")
    out.push({ brandId, detector: "self_engagement", severity: "low", windowStart: day, windowEnd: day, evidence: { events: list.length, accounts: new Set(list.map((e) => e.actorId)).size }, eventSeqs: [], matchSeqs: [] })
  }
  return out
}

/** wishlist_churn: more than 10 users each adding and removing the same product more than 3× in a day. Low. */
export function wishlistChurn(events: readonly ChartEvent[], days: readonly string[]): Detection[] {
  const wanted = new Set(days)
  const out: Detection[] = []
  const rel = events.filter((e) => (e.kind === "wishlist_add" || e.kind === "wishlist_remove") && e.productId && wanted.has(e.day))
  for (const [key, list] of groupBy(rel, (e) => `${e.brandId}|${e.day}`)) {
    const perUserProduct = groupBy(list, (e) => `${e.actorId}|${e.productId}`)
    const churners = new Set<string>()
    for (const [k, l] of perUserProduct) {
      const adds = l.filter((e) => e.kind === "wishlist_add").length
      const removes = l.filter((e) => e.kind === "wishlist_remove").length
      if (Math.min(adds, removes) > 3) churners.add(k.split("|")[0])
    }
    if (churners.size <= 10) continue
    const [brandId, day] = key.split("|")
    out.push({ brandId, detector: "wishlist_churn", severity: "low", windowStart: day, windowEnd: day, evidence: { users: churners.size }, eventSeqs: [], matchSeqs: [] })
  }
  return out
}

/**
 * order_anomaly: ≥ 3 orders from the same customer and brand in a day, or ≥ 5 orders for a brand
 * in a day with more than 40 % cancelled within 24 hours. Medium; those orders leave O and G.
 * Inert in this build: no order signals are emitted until a payment-confirmation path exists.
 */
export function orderAnomaly(events: readonly ChartEvent[], days: readonly string[]): Detection[] {
  const wanted = new Set(days)
  const out: Detection[] = []
  const orders = events.filter((e) => e.kind === "order_placed" && live(e) && wanted.has(e.day))
  const cancels = events.filter((e) => e.kind === "order_cancelled" && live(e))
  for (const [key, list] of groupBy(orders, (e) => `${e.brandId}|${e.day}`)) {
    const [brandId, day] = key.split("|")
    const repeated = [...groupBy(list, (e) => e.actorId)].filter(([, l]) => l.length >= 3)
    // An order is "cancelled within 24 h" when the same customer cancels for the same brand within a day of placing.
    const cancelled = list.filter((o) => cancels.some((c) => c.brandId === o.brandId && c.actorId === o.actorId && c.at >= o.at && c.at - o.at <= 86_400_000))
    const cancelShare = list.length ? cancelled.length / list.length : 0
    if (repeated.length) {
      const seqs = repeated.flatMap(([, l]) => l)
      out.push({ brandId, detector: "order_anomaly", severity: "medium", windowStart: day, windowEnd: day, evidence: { rule: "repeat_customer", customers: repeated.length, orders: seqs.length }, eventSeqs: countedOnly(seqs), matchSeqs: seqs.map((e) => e.seq) })
    } else if (list.length >= 5 && cancelShare > 0.4) {
      out.push({ brandId, detector: "order_anomaly", severity: "medium", windowStart: day, windowEnd: day, evidence: { rule: "cancelled_share", orders: list.length, cancelledShare: round2(cancelShare) }, eventSeqs: countedOnly(cancelled), matchSeqs: cancelled.map((e) => e.seq) })
    }
  }
  return out
}

/**
 * coordinated_ring: ≥ 5 accounts under 7 days old that each followed the same ≥ 3 brands within
 * 10 minutes. High on every brand involved.
 */
export function coordinatedRing(events: readonly ChartEvent[], days: readonly string[]): Detection[] {
  const wanted = new Set(days)
  const follows = events.filter((e) => e.kind === "follow" && live(e) && wanted.has(e.day) && e.accountAgeDays !== null && e.accountAgeDays < 7)
  // For each account, every set of ≥ 3 brands it followed inside one 10-minute span.
  const accountsBySet = new Map<string, { actors: Set<string>; events: ChartEvent[] }>()
  for (const [actorId, list] of groupBy(follows, (e) => e.actorId)) {
    const sorted = [...list].sort((a, b) => a.at - b.at)
    const seen = new Set<string>()
    for (let i = 0; i < sorted.length; i++) {
      const span = sorted.filter((e) => e.at >= sorted[i].at && e.at - sorted[i].at <= 600_000)
      const brandIds = [...new Set(span.map((e) => e.brandId))].sort()
      if (brandIds.length < 3) continue
      for (const triple of combinations(brandIds, 3)) {
        const key = triple.join(",")
        if (seen.has(key)) continue
        seen.add(key)
        const slot = accountsBySet.get(key) ?? { actors: new Set(), events: [] }
        slot.actors.add(actorId)
        slot.events.push(...span.filter((e) => triple.includes(e.brandId)))
        accountsBySet.set(key, slot)
      }
    }
  }
  const out = new Map<string, Detection>()
  for (const [key, slot] of accountsBySet) {
    if (slot.actors.size < 5) continue
    const brands = key.split(",")
    for (const brandId of brands) {
      const evs = slot.events.filter((e) => e.brandId === brandId)
      const start = evs.reduce((m, e) => (e.day < m ? e.day : m), evs[0].day)
      const end = evs.reduce((m, e) => (e.day > m ? e.day : m), evs[0].day)
      const prev = out.get(brandId)
      if (prev && (prev.evidence.accounts as number) >= slot.actors.size) continue
      out.set(brandId, {
        brandId,
        detector: "coordinated_ring",
        severity: "high",
        windowStart: start,
        windowEnd: end,
        evidence: { accounts: slot.actors.size, brands: brands.length, otherBrands: brands.filter((b) => b !== brandId).join(" "), withinMinutes: 10 },
        eventSeqs: countedOnly(evs),
        matchSeqs: evs.map((e) => e.seq),
      })
    }
  }
  return [...out.values()]
}

function combinations<T>(list: readonly T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (list.length < k) return []
  const [head, ...rest] = list
  return [...combinations(rest, k - 1).map((c) => [head, ...c]), ...combinations(rest, k)]
}

const round2 = (x: number) => Math.round(x * 100) / 100

/**
 * Every detector over the last `days` (newest last). `ipKnown` is false when the server can't see
 * client IPs (YARD_TRUSTED_PROXY_HOPS=0): ip_concentration doesn't run then.
 */
export function detectAll(events: readonly ChartEvent[], days: readonly string[], opts: { ipKnown: boolean; ipWindowDays?: number }): Detection[] {
  const to = days[days.length - 1]
  const from = days[Math.max(0, days.length - (opts.ipWindowDays ?? 7))]
  // The ring first: when it and the IP rule match the same signals, the ring's flag excludes them.
  return [
    ...coordinatedRing(events, days),
    ...velocitySpike(events, days),
    ...(opts.ipKnown ? ipConcentration(events, from, to) : []),
    ...newAccountShare(events, days),
    ...selfEngagement(events, days),
    ...wishlistChurn(events, days),
    ...orderAnomaly(events, days),
  ]
}

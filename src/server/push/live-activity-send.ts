/**
 * The Live Activity send loop: given an order's tokens and the order as the app sees it, decide
 * each push, send it through `sender` (an ApnsClient, or a fake in tests), and keep the table
 * right (what was sent, ended activities' and dead tokens deleted). No "server-only": the database
 * and the sender are passed in, so live-activity.test.ts runs it on PGlite against a mock APNs.
 * The server-only wiring (config, when to run) is live-activity.ts.
 */
import { asLiveState, buildLiveActivityPayload, DELIVERED_DISMISS_MS, pushDecision, RELEVANCE, STALE_AFTER_MS, apnsTokenGone, type LivePush } from "./apns-core"
import type { ApnsAnswer } from "./apns"
import { deleteTokens, markSent, type Db, type TokenRow } from "./live-activity-db"
import type { LiveActivityResult, LiveState } from "./live-activity-state"

export type LiveSender = { send(deviceToken: string, payload: unknown, priority: 5 | 10): Promise<ApnsAnswer> }

/** The order as the app sees it, in a given phone time zone (live-activity-state.ts). */
export type OrderSnapshot = { orderId: string; closedAs: "cancelled" | "returned"; at: (timeZone: string) => LiveActivityResult }

export type SendHooks = { count: (event: "live_activity.sent" | "live_activity.failed" | "live_activity.removed") => void; warn: (msg: string, e?: unknown) => void }

/** What a closed (cancelled / returned) activity shows for the instant before it goes. */
export function closedState(last: LiveState | null, r: LiveActivityResult, closedAs: "cancelled" | "returned"): LiveState {
  return { step: last?.step ?? "shipped", etaMs: null, progress: last?.progress ?? 0.25, statusLine: closedAs === "cancelled" ? `Cancelled by ${r.brandName}` : `Returned to ${r.brandName}` }
}

type Outcome = "sent" | "gone" | "failed"

async function sendOne(sender: LiveSender, hooks: SendHooks, token: TokenRow, push: LivePush, priority: 5 | 10): Promise<Outcome> {
  try {
    const a = await sender.send(token.token, buildLiveActivityPayload(push), priority)
    if (a.status === 200) {
      hooks.count("live_activity.sent")
      return "sent"
    }
    hooks.count("live_activity.failed")
    if (apnsTokenGone(a.status, a.reason)) {
      hooks.count("live_activity.removed")
      return "gone"
    }
    hooks.warn(`[yard] push: APNs answered ${a.status} ${a.reason ?? ""} for Live Activity token ${token.id} (${push.event})`)
    return "failed"
  } catch (e) {
    hooks.count("live_activity.failed")
    hooks.warn(`[yard] push: Live Activity send to token ${token.id} failed`, e)
    return "failed"
  }
}

/**
 * Update tokens: update / end (delivered: dismissed 2 h later; cancelled or returned: at once),
 * only what changed (pushDecision). Start tokens: start an activity when the order is on its way.
 * A token APNs reports gone, and the token of an activity just ended, are deleted.
 */
export async function pushToTokens(
  d: Db,
  sender: LiveSender,
  hooks: SendHooks,
  input: { tokens: TokenRow[]; starts: TokenRow[]; snap: OrderSnapshot; fallbackTz: string; now: number; refresh: boolean },
): Promise<{ sent: number; removed: number }> {
  const { snap, now } = input
  const gone: string[] = []
  let sent = 0

  for (const t of input.tokens) {
    const r = snap.at(t.timeZone || input.fallbackTz)
    const last = asLiveState(t.lastState)
    let push: LivePush
    let priority: 5 | 10 = 10
    let ended = false
    if (r.closed) {
      push = { event: "end", state: closedState(last, r, snap.closedAs), nowMs: now, dismissalMs: now - 1000, relevance: 0 }
      ended = true
    } else if (!r.state) {
      continue
    } else if (r.state.step === "delivered") {
      push = { event: "end", state: r.state, nowMs: now, dismissalMs: now + DELIVERED_DISMISS_MS, relevance: RELEVANCE.delivered }
      ended = true
    } else {
      const decision = pushDecision(last, r.state, t.lastSentAt?.getTime() ?? null, now, input.refresh)
      if (!decision.send) continue
      priority = decision.priority
      push = { event: "update", state: r.state, nowMs: now, staleMs: now + STALE_AFTER_MS, relevance: RELEVANCE[r.state.step] }
    }
    const outcome = await sendOne(sender, hooks, t, push, priority)
    if (outcome === "sent") {
      sent++
      // An ended activity takes no more pushes: its token goes.
      if (ended) gone.push(t.id)
      else await markSent(d, t.id, push.state, new Date(now))
    } else if (outcome === "gone") gone.push(t.id)
  }

  for (const t of input.starts) {
    const r = snap.at(t.timeZone || input.fallbackTz)
    if (r.closed || !r.state || !["shipped", "outForDelivery", "arrivingSoon"].includes(r.state.step)) continue
    const push: LivePush = {
      event: "start",
      state: r.state,
      nowMs: now,
      staleMs: now + STALE_AFTER_MS,
      relevance: RELEVANCE[r.state.step],
      attributes: { orderId: snap.orderId, brandName: r.brandName, brandCity: r.brandCity, deliveryCity: r.deliveryCity },
      alert: { title: `${r.brandName} shipped your order`, body: r.state.statusLine },
    }
    const outcome = await sendOne(sender, hooks, t, push, 10)
    if (outcome === "sent") sent++
    else if (outcome === "gone") gone.push(t.id)
  }

  await deleteTokens(d, gone)
  return { sent, removed: gone.length }
}

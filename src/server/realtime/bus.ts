import "server-only"
import { EventEmitter } from "node:events"
import { afterCommit, db } from "../db"
import { realtimeEvents } from "../db/schema"
import { yard } from "../state"
import { toDurable } from "./durable"

/** What subscribers receive. `seq` is absent for ephemeral events (typing, session.ended). */
export type BusEvent = { seq?: number; channel: string; type: string; payload: unknown }

function bus() {
  if (!yard.bus) {
    yard.bus = new EventEmitter()
    yard.bus.setMaxListeners(0)
  }
  return yard.bus
}

/**
 * Publishes an event (§4.1). A durable event inserts its redacted form into realtime_events
 * through db() (so inside the caller's transaction) and uses the returned seq as the event id.
 * Subscribers get the full payload through afterCommit: nothing is announced for a rollback.
 */
export async function publish(channel: string, type: string, payload: unknown, opts: { durable?: boolean } = {}) {
  const durable = opts.durable ?? true
  let seq: number | undefined
  if (durable) {
    const d = await db()
    const [row] = await d.insert(realtimeEvents).values({ channel, type, payload: toDurable(type, payload) }).returning({ seq: realtimeEvents.seq })
    seq = row.seq
  }
  const event: BusEvent = { seq, channel, type, payload }
  afterCommit(() => {
    bus().emit(channel, event)
  })
  return seq
}

/** Subscribes to several channels; returns the unsubscribe function. */
export function subscribe(channelList: string[], listener: (e: BusEvent) => void) {
  const b = bus()
  for (const c of channelList) b.on(c, listener)
  return () => {
    for (const c of channelList) b.off(c, listener)
  }
}

/** Current listener count on a channel (tests and the selftest). */
export function listenerCount(channel: string) {
  return bus().listenerCount(channel)
}

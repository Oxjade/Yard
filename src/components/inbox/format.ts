/** Dates and times in the chat, en-GB like the rest of Yard. */

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** "Today", "Yesterday", "Wed 4 Nov" (with the year when it isn't this year). */
export function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso)
  if (dayKey(d) === dayKey(now)) return "Today"
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (dayKey(d) === dayKey(y)) return "Yesterday"
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })
}

export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b))

/** "14:05". */
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

/**
 * The receipt under your newest message. The day is named whenever the read happened on another
 * day than the message, so a "Yesterday" message never reads as seen before it was sent:
 * "Seen 14:05" (same day), "Seen today 14:05", "Seen yesterday 19:40", "Seen 4 Nov, 09:12".
 */
export function seenLabel(iso: string | null, messageIso?: string, now = new Date()) {
  if (!iso) return "Seen"
  const time = timeLabel(iso)
  if (messageIso ? sameDay(iso, messageIso) : dayLabel(iso, now) === "Today") return `Seen ${time}`
  const day = dayLabel(iso, now)
  if (day === "Today") return `Seen today ${time}`
  if (day === "Yesterday") return `Seen yesterday ${time}`
  return `Seen ${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`
}

/** A sentence that ends with a name: no second full stop when it already ends in . ! or ? ("Kumasi Thread Co."). */
export const sentence = (text: string) => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/** "Mar 2026". */
export const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" })

/** "4 Nov 2026". */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

/** "3 h", "2 d" for "Waiting 3 h". */
export function waitingFor(iso: string, now = Date.now()) {
  const h = Math.floor((now - new Date(iso).getTime()) / 3600_000)
  if (h < 24) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** Held reasons as people read them (the sender's own held message, §5.2). */
export function heldExplanation(side: "customer" | "brand") {
  return side === "customer" ? "Messages with several links or payment requests outside Yard are checked first." : "Yard checks messages that ask for payment outside checkout."
}

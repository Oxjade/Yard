/** Deterministic pseudo-random helpers so server and client render identical data. */

export function hash(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A stable number in [0, 1) for a key. */
export function rand(key: string) {
  return (hash(key) % 100000) / 100000
}

export function randInt(key: string, min: number, max: number) {
  return Math.floor(min + rand(key) * (max - min + 1))
}

export function pick<T>(key: string, list: readonly T[]) {
  return list[hash(key) % list.length]
}

/** Reference "today" for the demo data. */
export const DEMO_TODAY = "2026-11-05"

export function daysAgo(days: number) {
  const d = new Date(`${DEMO_TODAY}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString()
}

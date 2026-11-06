import "server-only"
import { yard } from "./state"

/**
 * Strips secrets from anything logged (§5.5): access and refresh tokens, OAuth codes and client
 * secrets in objects, and the whole query string of any URL (Instagram puts client_secret and
 * access_token in the URL, and fetch errors repeat it).
 */
export function redact(value: unknown): unknown {
  if (value instanceof Error) {
    const e = new Error(redactText(value.message))
    e.name = value.name
    e.stack = value.stack ? redactText(value.stack) : undefined
    return e
  }
  if (typeof value === "string") return redactText(value)
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = /^(access_token|refresh_token|code|client_secret|token|password|secret)$/i.test(k) ? "[redacted]" : redact(v)
    return out
  }
  return value
}

function redactText(s: string) {
  return s
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']*/g, "$1?…")
    .replace(/(access_token|refresh_token|client_secret|code)=([^&\s"']+)/gi, "$1=[redacted]")
}

export const log = {
  info: (...args: unknown[]) => console.log(...args.map(redact)),
  warn: (...args: unknown[]) => console.warn(...args.map(redact)),
  error: (...args: unknown[]) => console.error(...args.map(redact)),
  /** Logs a message only the first time `key` is seen in this process. */
  once(key: string, level: "info" | "warn" | "error", ...args: unknown[]) {
    const seen = (yard.logged ??= new Set())
    if (seen.has(key)) return
    seen.add(key)
    log[level](...args)
  },
}

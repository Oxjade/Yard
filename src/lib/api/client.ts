import type { z } from "zod"

/**
 * The typed fetch helper every client component uses to call the v2 server (§1.9). Sends
 * credentials (same-origin), JSON and `X-Yard-Client: 1` (the CSRF header, §2.5); parses the error
 * wire format into an ApiError; validates responses against `schema` in development only.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
    public retryAfter?: number,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export type ApiInit<T> = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  schema?: z.ZodType<T>
  keepalive?: boolean
  /**
   * The fetch cache mode. Default "no-store": most reads are per-identity and must be fresh. Pass
   * "default" only for a public GET whose route declares `cache: { public }`, so the browser honours
   * its max-age instead of asking the server again on every page.
   */
  cache?: RequestCache
}

/** Every in-flight request, so resetApiCache() can abort them on an identity change. */
export const inflight = new Set<AbortController>()

export function withQuery(path: string, query?: ApiInit<unknown>["query"]) {
  if (!query) return path
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v))
  const s = q.toString()
  return s ? `${path}${path.includes("?") ? "&" : "?"}${s}` : path
}

export async function api<T = unknown>(path: string, init: ApiInit<T> = {}): Promise<T> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(init.signal?.reason)
  if (init.signal) {
    if (init.signal.aborted) controller.abort(init.signal.reason)
    else init.signal.addEventListener("abort", onAbort, { once: true })
  }
  inflight.add(controller)
  const headers: Record<string, string> = { "X-Yard-Client": "1", Accept: "application/json" }
  if (init.body !== undefined) headers["Content-Type"] = "application/json"
  try {
    let res: Response
    try {
      res = await fetch(withQuery(path, init.query), {
        method: init.method ?? (init.body !== undefined ? "POST" : "GET"),
        credentials: "same-origin",
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
        keepalive: init.keepalive,
        cache: init.cache ?? "no-store",
      })
    } catch (e) {
      if (controller.signal.aborted) throw e
      throw new ApiError(0, "network", "You're offline or Yard can't be reached. Check your connection and try again.")
    }
    const text = await res.text()
    let data: unknown = undefined
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = undefined
      }
    }
    if (!res.ok) {
      const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | undefined)?.error
      const retry = Number(res.headers.get("Retry-After"))
      throw new ApiError(res.status, err?.code ?? (res.status === 404 ? "not_found" : "internal"), err?.message ?? "Something went wrong on our side. Try again.", err?.fields, Number.isFinite(retry) && retry > 0 ? retry : undefined)
    }
    if (init.schema && process.env.NODE_ENV !== "production") {
      const parsed = init.schema.safeParse(data)
      if (!parsed.success) console.warn(`[api] ${path} response doesn't match its contract`, parsed.error.issues.slice(0, 5))
    }
    return data as T
  } finally {
    inflight.delete(controller)
    init.signal?.removeEventListener("abort", onAbort)
  }
}

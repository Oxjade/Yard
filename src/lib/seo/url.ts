/**
 * Yard's public address for structured data, feeds, sitemaps and llms.txt. Read at request time
 * (YARD_PUBLIC_URL, the same variable robots.ts, sitemap and the root metadataBase use); unset or
 * malformed, it falls back to the server's own default. Pure: no imports, safe under `tsx --test`.
 */
export function publicOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = env.YARD_PUBLIC_URL?.trim() || "http://localhost:3000"
  try {
    const u = new URL(raw)
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`
  } catch {
    return "http://localhost:3000"
  }
}

/** An absolute URL for a path or an already-absolute address (photos may live on another host). */
export function absoluteUrl(base: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${base.replace(/\/+$/, "")}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`
}

/** One-line plain text: collapses whitespace and cuts at a word boundary with an ellipsis. */
export function plainText(text: string | null | undefined, max = 5000): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const at = cut.lastIndexOf(" ")
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:!?-]+$/, "")}…`
}

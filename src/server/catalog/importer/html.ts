/**
 * Small, dependency-free readers for what the importer looks for in a page: JSON-LD, OpenGraph and
 * other meta tags, schema.org microdata, links, sitemap entries and the Next.js App Router flight
 * payload (self.__next_f.push). Plain TypeScript, no server-only, so the tests load it directly.
 * These read untrusted HTML: nothing here evaluates it, and every result is plain data.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", naira: "₦", pound: "£", euro: "€" }

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * Plain text from an HTML fragment: block tags become line breaks, everything else is dropped. Line
 * breaks the source already has (a plain-text description, "\r\n" or "\n") are kept, so
 * "Material : PVC\nHeight : 42cm" stays two lines; the product page shows them as breaks.
 */
export function htmlToText(html: string | null | undefined, max = 4000) {
  if (!html) return ""
  const text = decodeEntities(
    html
      .replace(/<(script|style|noscript|template)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr|ul|ol|section|article)>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, ""),
  )
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max)
}

/** Attributes of one tag's source ("<meta property=… content=…>"). */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "")
  return out
}

/* ---------- JSON-LD ---------- */

export type LdNode = Record<string, unknown>

/** Every JSON-LD node in the page, with @graph arrays and nested arrays flattened. Bad blocks are skipped. */
export function jsonLd(html: string): LdNode[] {
  const out: LdNode[] = []
  const push = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(push)
    else if (v && typeof v === "object") {
      const o = v as LdNode
      if (Array.isArray(o["@graph"])) (o["@graph"] as unknown[]).forEach(push)
      else out.push(o)
    }
  }
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1]
      .trim()
      .replace(/^<!\[CDATA\[|\]\]>$/g, "")
      .replace(/^<!--|-->$/g, "")
    try {
      push(JSON.parse(body))
    } catch {
      // Some sites put raw newlines inside strings; one forgiving retry.
      try {
        push(JSON.parse(body.replace(/[\r\n\t]+/g, " ")))
      } catch {
        /* not JSON */
      }
    }
  }
  return out
}

export function ldTypes(n: LdNode): string[] {
  const t = n["@type"]
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, ""))
}

export const isType = (n: LdNode, ...types: string[]) => ldTypes(n).some((t) => types.includes(t))

/** A string from a JSON-LD value that may be a string, a number, an array or { "@value" }. */
export function ldText(v: unknown): string | null {
  if (v == null) return null
  if (typeof v === "string") return decodeEntities(v).trim() || null
  if (typeof v === "number") return String(v)
  if (Array.isArray(v)) return ldText(v[0])
  if (typeof v === "object") {
    const o = v as LdNode
    return ldText(o["@value"] ?? o.name ?? o.url ?? null)
  }
  return null
}

/** Image URLs from a JSON-LD image value (string, array, ImageObject). */
export function ldImages(v: unknown): string[] {
  if (!v) return []
  if (typeof v === "string") return [v]
  if (Array.isArray(v)) return v.flatMap(ldImages)
  if (typeof v === "object") {
    const o = v as LdNode
    const u = o.contentUrl ?? o.url
    return typeof u === "string" ? [u] : []
  }
  return []
}

/* ---------- meta, links, microdata ---------- */

/** content of <meta property|name|itemprop="key">, first match. */
export function meta(html: string, key: string): string | null {
  const k = key.toLowerCase()
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0])
    if ((a.property ?? a.name ?? a.itemprop ?? "").toLowerCase() === k && a.content) return a.content.trim() || null
  }
  return null
}

export function title(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() || null : null
}

/** <link rel="…"> href, first match (rel compared as a word list). */
export function linkRel(html: string, rel: string): string | null {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0])
    if ((a.rel ?? "").toLowerCase().split(/\s+/).includes(rel) && a.href) return a.href
  }
  return null
}

/** Every <a href> in the page, absolute, without fragments; javascript:, mailto: and the like are dropped. */
export function links(html: string, base: string): string[] {
  const out = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
    const raw = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "").trim()
    if (!raw || /^(javascript|mailto|tel|sms|data):/i.test(raw) || raw.startsWith("#")) continue
    try {
      const u = new URL(raw, base)
      if (u.protocol !== "http:" && u.protocol !== "https:") continue
      u.hash = ""
      out.add(u.toString())
    } catch {
      /* not a URL */
    }
  }
  return [...out]
}

/** <loc> entries of a sitemap, and whether it is an index of other sitemaps. */
export function sitemap(xml: string): { index: boolean; locs: string[] } {
  const index = /<sitemapindex\b/i.test(xml)
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?\s*<\/loc>/gi)].map((m) => decodeEntities(m[1].trim())).filter(Boolean)
  return { index, locs }
}

/** "Sitemap:" lines of a robots.txt. */
export function robotsSitemaps(txt: string): string[] {
  return [...txt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1])
}

/**
 * schema.org Product microdata, read loosely: the first itemprop values inside the page for name,
 * description, price, priceCurrency, image, availability, sku. Null when the page declares no Product.
 */
export function microdataProduct(html: string): { name: string | null; description: string | null; price: string | null; currency: string | null; images: string[]; availability: string | null; sku: string | null } | null {
  if (!/itemtype\s*=\s*["']?https?:\/\/schema\.org\/Product/i.test(html)) return null
  const prop = (name: string): string[] => {
    const vals: string[] = []
    const re = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bitemprop\\s*=\\s*["']?${name}["']?[^>]*>`, "gi")
    for (const m of html.matchAll(re)) {
      const a = attrs(m[0])
      const v = a.content ?? a.src ?? a.href ?? (m[1].toLowerCase() === "meta" ? "" : (/^[^<]*/.exec(html.slice((m.index ?? 0) + m[0].length))?.[0] ?? ""))
      const t = decodeEntities(v).trim()
      if (t) vals.push(t)
    }
    return vals
  }
  return { name: prop("name")[0] ?? null, description: prop("description")[0] ?? null, price: prop("price")[0] ?? null, currency: prop("priceCurrency")[0] ?? null, images: prop("image"), availability: prop("availability")[0] ?? null, sku: prop("sku")[0] ?? null }
}

/* ---------- Next.js flight payload ---------- */

/** The App Router's streamed RSC payload, decoded and joined (self.__next_f.push([1,"…"])). */
export function nextFlight(html: string): string {
  let out = ""
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try {
      out += JSON.parse(m[1]) as string
    } catch {
      /* a broken chunk */
    }
  }
  return out
}

/** End index (exclusive) of the JSON value that starts at `start` ({ or [), or -1. Strings and escapes are respected. */
export function jsonEnd(text: string, start: number): number {
  const open = text[start]
  if (open !== "{" && open !== "[") return -1
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      if (c === "\\") i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{" || c === "[") depth++
    else if (c === "}" || c === "]") {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** Every JSON value that follows `marker` (e.g. `"product":`), parsed; ones that don't parse are skipped. */
export function jsonValuesAfter(text: string, marker: string, limit = 50): unknown[] {
  const out: unknown[] = []
  let from = 0
  while (out.length < limit) {
    const at = text.indexOf(marker, from)
    if (at < 0) break
    const start = at + marker.length
    const end = jsonEnd(text, start)
    from = start
    if (end < 0) continue
    try {
      out.push(JSON.parse(text.slice(start, end)))
      from = end
    } catch {
      /* not JSON */
    }
  }
  return out
}

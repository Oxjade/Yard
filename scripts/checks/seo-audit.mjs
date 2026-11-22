#!/usr/bin/env node
// SEO crawl audit: node scripts/checks/seo-audit.mjs [base] [--out report.md] [--max 300] [--delay ms] [--plain] [--render N]
//
// Crawls a running Yard (local demo, staging or the live site) the way a search crawler does:
// /robots.txt, /sitemap.xml (and its parts), every sitemap page up to --max, plus the key public
// pages that are not in the sitemap. For each page it records the <img> tags without an alt
// attribute (alt="" counts as a decorative image, not a missing one), the meta description (in the
// <head>, or only streamed into the <body>), the number of <h1>, the title and its length, the
// canonical link and the robots meta / X-Robots-Tag. Every sitemap URL is also checked against the
// robots.txt rules Bingbot follows, and /_next/static and /_next/image must stay crawlable.
//
// Polite by default: one request at a time, --delay ms between them (1100 ms for a remote host,
// 0 for localhost), User-Agent "YardSEOAudit/1.0 (compatible; Bingbot render check)": the Bingbot
// token makes Next render the page the way it does for Bingbot (the whole page and its metadata in
// the first response). --plain drops it, to see what a browser's first response holds (a static
// shell whose streamed parts JavaScript fills in). --render N also loads the first N pages in
// headless Chrome (CHROME, else google-chrome or chromium on PATH; pictures not downloaded) and
// counts <img> and <h1> in the DOM after JavaScript ran, which is what Bing's renderer sees.
// Exit code 1 when an indexable page has a missing alt, no description, or not exactly one <h1>.
// Plain Node 22+, no dependencies; behind an HTTPS proxy run with NODE_USE_ENV_PROXY=1.
import { execFileSync, spawnSync } from "node:child_process"
import { writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const argv = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const base = new URL(argv.find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:3001")
const origin = base.origin
const local = ["localhost", "127.0.0.1"].includes(base.hostname)
const max = Number(opt("--max", "300"))
const delay = Number(opt("--delay", local ? "0" : "1100"))
const out = opt("--out", null)
const UA = `YardSEOAudit/1.0${argv.includes("--plain") ? "" : " (compatible; Bingbot render check)"}`
const renderMax = Number(opt("--render", "0"))

const EXTRA = [
  "/",
  "/shop",
  "/shop?page=2",
  "/brands",
  "/drops",
  "/charts",
  "/around",
  "/sell",
  "/support",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refunds",
  "/legal/seller-agreement",
  "/legal/data-deletion",
  "/categories",
  "/stories",
  "/shop?q=shirt",
  "/this-page-does-not-exist-seo-audit",
  "/products/this-product-does-not-exist-seo-audit",
]
// Private pages: expected to answer noindex (meta or header) or redirect to sign-in.
const PRIVATE = ["/you", "/bag", "/checkout", "/inbox", "/wishlist", "/following", "/notifications", "/welcome", "/sign-in", "/studio", "/admin"]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let last = 0
async function get(p, { redirect = "follow" } = {}) {
  const wait = last + delay - Date.now()
  if (wait > 0) await sleep(wait)
  last = Date.now()
  const url = new URL(p, origin)
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xml;q=0.9,*/*;q=0.8" }, redirect })
    const body = await res.text()
    return { status: res.status, url: res.url || url.href, headers: res.headers, body, redirected: res.redirected }
  } catch (e) {
    return { status: 0, url: url.href, headers: new Headers(), body: "", error: String(e?.cause?.code ?? e?.message ?? e) }
  }
}

// ── robots.txt (RFC 9309: the most specific group for the agent; the longest matching rule wins, Allow on a tie)
function parseRobots(txt) {
  const groups = []
  let cur = null
  let lastWasAgent = false
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1].toLowerCase()
    const val = m[2].trim()
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }))
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
    } else {
      lastWasAgent = false
      if (cur && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", path: val })
    }
  }
  return groups
}
function groupFor(groups, agent) {
  const a = agent.toLowerCase()
  return groups.find((g) => g.agents.includes(a)) ?? groups.find((g) => g.agents.includes("*")) ?? { agents: [], rules: [] }
}
function ruleRe(p) {
  const anchored = p.endsWith("$")
  const body = (anchored ? p.slice(0, -1) : p).replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp("^" + body + (anchored ? "$" : ""))
}
function robotsVerdict(group, pathAndQuery) {
  let best = null
  for (const r of group.rules) {
    if (r.path === "") continue
    if (!ruleRe(r.path).test(pathAndQuery)) continue
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r
  }
  return { allowed: !best || best.allow, rule: best ? `${best.allow ? "Allow" : "Disallow"}: ${best.path}` : "(no rule)" }
}

// ── HTML
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)
  return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null
}
const hasAttr = (tag, name) => new RegExp(`\\s${name}(?=[\\s=/>])`, "i").test(tag)
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")

// An image's component, roughly: its class list without the src, so the same card counts once.
const imgKey = (t) => `${hasAttr(t, "data-nimg") ? "next/image" : "img"} .${(attr(t, "class") ?? "").split(/\s+/).filter(Boolean).slice(0, 4).join(".")}`

function chromePath() {
  for (const c of [process.env.CHROME, "google-chrome", "chromium", "chromium-browser"].filter(Boolean)) {
    try {
      execFileSync("which", [c], { stdio: "ignore" })
      return c
    } catch {}
  }
  return null
}
const chrome = renderMax > 0 ? chromePath() : null
function renderDom(p) {
  const args = ["--headless=new", "--no-sandbox", "--disable-gpu", "--blink-settings=imagesEnabled=false", `--user-agent=${UA}`, "--window-size=1280,900", "--virtual-time-budget=8000", "--dump-dom", new URL(p, origin).href]
  const proxy = !local && (process.env.HTTPS_PROXY || process.env.https_proxy)
  if (proxy) args.unshift(`--proxy-server=${proxy}`)
  const r = spawnSync(chrome, args, { encoding: "utf8", timeout: 90_000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
  return r.stdout || ""
}

function analyse(html) {
  const headEnd = html.search(/<\/head>/i)
  const head = headEnd >= 0 ? html.slice(0, headEnd) : ""
  // Only real markup: drop scripts (the RSC payload) and styles before counting tags.
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "")
  const imgs = markup.match(/<img\b[^>]*>/gi) ?? []
  const missing = imgs.filter((t) => !hasAttr(t, "alt"))
  const empty = imgs.filter((t) => hasAttr(t, "alt") && (attr(t, "alt") ?? "").trim() === "")
  const metas = (src) => src.match(/<meta\b[^>]*>/gi) ?? []
  const named = (src, n) => metas(src).find((t) => (attr(t, "name") ?? "").toLowerCase() === n)
  const descHead = named(head, "description")
  const descAny = named(markup, "description")
  const robotsMeta = named(markup, "robots")
  const titleHead = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)
  const titleAny = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(markup)
  const canonical = (markup.match(/<link\b[^>]*>/gi) ?? []).find((t) => /\srel\s*=\s*["']?canonical/i.test(t))
  const h1s = (markup.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? []).map((t) => decode(t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 60))
  const title = titleAny ? decode(titleAny[1].trim()) : ""
  return {
    imgs: imgs.length,
    missingAlt: missing.length,
    emptyAlt: empty.length,
    emptySamples: empty.map(imgKey),
    missingSamples: missing.slice(0, 3).map((t) => (attr(t, "src") ?? "").slice(0, 70) + (attr(t, "class") ? ` .${attr(t, "class").split(/\s+/).slice(0, 3).join(".")}` : "")),
    description: descAny ? decode(attr(descAny, "content") ?? "") : null,
    descriptionInHead: !!descHead,
    h1: h1s.length,
    h1Text: h1s,
    title,
    titleInHead: !!titleHead,
    titleLength: title.length,
    canonical: canonical ? attr(canonical, "href") : null,
    robots: robotsMeta ? attr(robotsMeta, "content") : null,
  }
}

const locs = (xml) => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]))
const toPath = (u) => {
  const x = new URL(u, origin)
  return x.pathname + x.search
}

// ── crawl
const started = new Date()
const robotsRes = await get("/robots.txt")
const groups = parseRobots(robotsRes.body)
const bing = groupFor(groups, "bingbot")
const sm = await get("/sitemap.xml")
let sitemapUrls = []
const smNotes = [`/sitemap.xml: HTTP ${sm.status}`]
if (/<sitemapindex/i.test(sm.body)) {
  for (const part of locs(sm.body)) {
    const r = await get(toPath(part))
    smNotes.push(`${toPath(part)}: HTTP ${r.status}`)
    sitemapUrls.push(...locs(r.body))
  }
} else sitemapUrls = locs(sm.body)
const sitemapPaths = [...new Set(sitemapUrls.map(toPath))]
const crawlPaths = sitemapPaths.slice(0, max)
const skipped = sitemapPaths.slice(max)
const extra = EXTRA.filter((p) => !crawlPaths.includes(p))

const robotsRows = sitemapPaths.map((p) => ({ path: p, ...robotsVerdict(bing, p) }))
const blocked = robotsRows.filter((r) => !r.allowed)
const assets = ["/_next/static/chunks/main.js", "/_next/static/css/app.css", "/_next/image?url=%2Fapi%2Fmedia%2Fx&w=640&q=75", "/api/media/example", "/llms.txt", "/feeds/products.json"].map((p) => ({ path: p, ...robotsVerdict(bing, p) }))
const privateRules = PRIVATE.map((p) => ({ path: p, ...robotsVerdict(bing, p) }))

const pages = []
for (const [p, kind] of [...crawlPaths.map((p) => [p, "sitemap"]), ...extra.map((p) => [p, "extra"])]) {
  const r = await get(p)
  const html = /html/i.test(r.headers.get("content-type") ?? "") ? r.body : ""
  const a = analyse(html)
  const xRobots = r.headers.get("x-robots-tag")
  const noindex = /noindex/i.test(`${a.robots ?? ""} ${xRobots ?? ""}`)
  const page = { path: p, kind, status: r.status, error: r.error, xRobots, noindex, ...a }
  if (chrome && html && pages.filter((x) => x.rendered).length < renderMax) {
    const wait = last + delay - Date.now()
    if (wait > 0) await sleep(wait)
    const dom = renderDom(p)
    last = Date.now()
    if (dom) {
      const imgs = dom.match(/<img\b[^>]*>/gi) ?? []
      page.rendered = { imgs: imgs.length, missingAlt: imgs.filter((t) => !hasAttr(t, "alt")).length, h1: (dom.match(/<h1\b/gi) ?? []).length, samples: imgs.filter((t) => !hasAttr(t, "alt")).slice(0, 3).map(imgKey) }
    }
  }
  pages.push(page)
  if (!local && (pages.length % 25 === 0)) process.stderr.write(`  ${pages.length} pages…\n`)
}
// Private pages: no redirect following, so a sign-in redirect is reported as such.
const privatePages = []
for (const p of PRIVATE) {
  const r = await get(p, { redirect: "manual" })
  const html = /html/i.test(r.headers.get("content-type") ?? "") ? r.body : ""
  const a = analyse(html)
  privatePages.push({ path: p, status: r.status, location: r.headers.get("location"), xRobots: r.headers.get("x-robots-tag"), robots: a.robots, robotsTxt: robotsVerdict(bing, p) })
}

// ── report
const indexable = pages.filter((p) => p.status === 200 && !p.noindex)
const fail = {
  missingAlt: indexable.filter((p) => p.missingAlt > 0),
  noDescription: indexable.filter((p) => !p.description),
  descNotInHead: indexable.filter((p) => p.description && !p.descriptionInHead),
  h1: pages.filter((p) => p.status !== 0 && p.h1 !== 1),
  noCanonical: indexable.filter((p) => !p.canonical),
  longTitle: indexable.filter((p) => p.titleLength > 60),
  longDescription: indexable.filter((p) => (p.description ?? "").length > 160),
}
const dupDesc = Object.entries(Object.groupBy(indexable.filter((p) => p.description), (p) => p.description)).filter(([, v]) => v.length > 1)
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ")
const sum = (k) => pages.reduce((n, p) => n + (p[k] ?? 0), 0)

const L = []
L.push(`# SEO audit: ${origin}`, "")
L.push(`Run ${started.toISOString()} by scripts/checks/seo-audit.mjs, User-Agent \`${UA}\`, ${delay} ms between requests.`, "")
L.push("## Summary", "")
L.push("| Check | Result |", "|---|---|")
L.push(`| Pages crawled | ${pages.length} (${crawlPaths.length} from the sitemap, ${extra.length} extra) |`)
L.push(`| Sitemap URLs | ${sitemapPaths.length}${skipped.length ? `, ${skipped.length} skipped past --max ${max}` : ""} (${smNotes.join("; ")}) |`)
L.push(`| Indexable pages (200, not noindex) | ${indexable.length} |`)
L.push(`| \`<img>\` total / missing alt attribute / alt="" (decorative) | ${sum("imgs")} / **${sum("missingAlt")}** on ${pages.filter((p) => p.missingAlt).length} pages / ${sum("emptyAlt")} |`)
const rendered = pages.filter((p) => p.rendered)
if (renderMax > 0) L.push(`| Rendered in Chrome (after JavaScript) | ${chrome ? `${rendered.length} pages: ${rendered.reduce((n, p) => n + p.rendered.imgs, 0)} <img>, **${rendered.reduce((n, p) => n + p.rendered.missingAlt, 0)}** missing alt, **${rendered.filter((p) => p.rendered.h1 !== 1).length}** pages with h1 count other than 1` : "skipped: no Chrome found (set CHROME)"} |`)
L.push(`| Indexable pages without a meta description | **${fail.noDescription.length}** |`)
L.push(`| Pages whose description is only streamed into the body (not in the head) | ${fail.descNotInHead.length} |`)
L.push(`| Pages with h1 count other than 1 | **${fail.h1.length}** (${["0", "2", "3+"].map((n) => `${n}: ${fail.h1.filter((p) => (n === "3+" ? p.h1 >= 3 : p.h1 === Number(n))).length}`).join(", ")}) |`)
L.push(`| Indexable pages without a canonical | ${fail.noCanonical.length} |`)
L.push(`| Titles over 60 characters | ${fail.longTitle.length} |`)
L.push(`| Descriptions over 160 characters | ${fail.longDescription.length} |`)
L.push(`| Descriptions shared by more than one page | ${dupDesc.length} groups (${dupDesc.reduce((n, [, v]) => n + v.length, 0)} pages) |`)
L.push(`| Sitemap URLs blocked for Bingbot by robots.txt | **${blocked.length}** |`)
L.push(`| Non-200 pages | ${pages.filter((p) => p.status !== 200).map((p) => `${p.path} ${p.status}`).join(", ") || "none"} |`)
L.push("")
L.push("## robots.txt as Bingbot reads it", "")
L.push(`Group used: \`User-Agent: ${bing.agents.join(", ") || "(none)"}\``, "")
L.push("```", robotsRes.body.trim(), "```", "")
L.push("| Path | Verdict | Rule |", "|---|---|---|")
for (const r of [...assets, ...privateRules]) L.push(`| ${esc(r.path)} | ${r.allowed ? "allowed" : "blocked"} | ${esc(r.rule)} |`)
L.push("")
L.push(blocked.length ? `Blocked sitemap URLs:\n\n${blocked.map((r) => `- ${r.path} (${r.rule})`).join("\n")}` : "No sitemap URL is blocked.", "")
L.push("## Private pages", "")
L.push("| Path | Status | Location | robots meta | X-Robots-Tag | robots.txt |", "|---|---|---|---|---|---|")
for (const p of privatePages) L.push(`| ${p.path} | ${p.status} | ${esc(p.location)} | ${esc(p.robots)} | ${esc(p.xRobots)} | ${p.robotsTxt.allowed ? "allowed" : "blocked"} |`)
L.push("")
if (fail.missingAlt.length) {
  L.push("## Images without an alt attribute (samples)", "")
  for (const p of fail.missingAlt.slice(0, 40)) L.push(`- ${p.path} (${p.missingAlt}): ${p.missingSamples.map((s) => `\`${esc(s)}\``).join(", ")}`)
  L.push("")
}
const emptyKinds = Object.entries(Object.groupBy(pages.flatMap((p) => p.emptySamples), (k) => k)).map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1])
if (emptyKinds.length) {
  L.push('## alt="" images by component (decorative or not: check each)', "")
  L.push("| Count | Image (tag and first classes) |", "|---|---|")
  for (const [k, n] of emptyKinds.slice(0, 25)) L.push(`| ${n} | \`${esc(k)}\` |`)
  L.push("")
}
if (rendered.some((p) => p.rendered.missingAlt || p.rendered.h1 !== 1)) {
  L.push("## Rendered DOM problems", "")
  for (const p of rendered.filter((p) => p.rendered.missingAlt || p.rendered.h1 !== 1)) L.push(`- ${p.path}: ${p.rendered.missingAlt} missing alt ${p.rendered.samples.map((s) => `\`${esc(s)}\``).join(", ")}; h1 ${p.rendered.h1}`)
  L.push("")
}
if (fail.h1.length) {
  L.push("## Pages with h1 count other than 1", "")
  for (const p of fail.h1.slice(0, 60)) L.push(`- ${p.path} (${p.h1}): ${p.h1Text.map((t) => `"${esc(t)}"`).join(", ")}`)
  L.push("")
}
if (dupDesc.length) {
  L.push("## Shared descriptions", "")
  for (const [d, v] of dupDesc.slice(0, 20)) L.push(`- "${esc(d.slice(0, 90))}…": ${v.slice(0, 8).map((p) => p.path).join(", ")}${v.length > 8 ? ` +${v.length - 8}` : ""}`)
  L.push("")
}
if (skipped.length) L.push("## Skipped (past --max)", "", skipped.map((p) => `- ${p}`).join("\n"), "")
L.push("## Every page", "")
L.push("| Path | Src | Status | img | no alt | alt=\"\" | desc | desc in head | h1 | title len | canonical | robots |", "|---|---|---|---|---|---|---|---|---|---|---|---|")
for (const p of pages) {
  L.push(`| ${esc(p.path)} | ${p.kind} | ${p.status}${p.error ? ` ${p.error}` : ""} | ${p.imgs} | ${p.missingAlt} | ${p.emptyAlt} | ${p.description ? `${p.description.length}c` : "**none**"} | ${p.description ? (p.descriptionInHead ? "yes" : "body") : "-"} | ${p.h1} | ${p.titleLength} | ${p.canonical ? "yes" : "no"} | ${esc(p.robots ?? "")}${p.xRobots ? ` / X: ${esc(p.xRobots)}` : ""} |`)
}
L.push("", "## CSV", "", "```csv", "path,source,status,img,missing_alt,empty_alt,description_length,description_in_head,h1,title_length,canonical,robots")
for (const p of pages) L.push([p.path, p.kind, p.status, p.imgs, p.missingAlt, p.emptyAlt, p.description?.length ?? 0, p.descriptionInHead ? 1 : 0, p.h1, p.titleLength, p.canonical ? 1 : 0, `"${(p.robots ?? "").replace(/"/g, "'")}"`].join(","))
L.push("```", "")

const report = L.join("\n")
if (out) {
  mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  writeFileSync(out, report)
  console.log(`wrote ${out}`)
}
console.log(L.slice(0, L.indexOf("## robots.txt as Bingbot reads it")).join("\n"))
const bad = fail.missingAlt.length + fail.noDescription.length + fail.h1.length + blocked.length + rendered.filter((p) => p.rendered.missingAlt || p.rendered.h1 !== 1).length
process.exit(bad ? 1 : 0)
